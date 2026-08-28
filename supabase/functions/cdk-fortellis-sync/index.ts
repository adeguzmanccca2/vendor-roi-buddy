// Manually-triggered pull of sales opportunities from CDK's Fortellis
// platform (CRM Sales Opportunities v2, GET /search) into our leads table
// for a user-chosen date range (e.g. once a month), enriched with
// customer name/email/phone from the CDK Drive Post Customer v1 API.
//
// Caller must be signed in as an admin, or a member of the target
// organization. Credentials (client id/secret, subscription id, token url,
// department id) come from cdk_fortellis_credentials, one row per
// dealership.
//
// READ-ONLY BY DESIGN: every call this function makes to *.fortellis.io is
// a GET (search opportunities, read customer) except the OAuth token
// exchange itself. Do not add POST/PUT/DELETE calls to CDK/Fortellis
// endpoints here (e.g. CreateOpportunityRequest, updateCustomer,
// subStatus/update) -- this integration must never write back to the CRM.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const OPPORTUNITIES_SERVICE_URL = 'https://api.fortellis.io/sales/v2/elead/opportunities';
const DRIVE_CUSTOMER_SERVICE_URL = 'https://api.fortellis.io/cdk/drive/customerpost/v1';
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // safety cap per manual run (5,000 opportunities)
const MAX_CUSTOMER_LOOKUPS = 1000; // safety cap on per-customer enrichment calls
const CUSTOMER_LOOKUP_CONCURRENCY = 5;

function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d.length >= 7 ? d : null;
}

function normalizeEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

interface DriveCustomerPhone {
  number?: string;
  isPrimary?: boolean;
  isPreferred?: boolean;
}

interface DriveCustomerEmail {
  address?: string;
  isPreferred?: boolean;
}

interface DriveCustomerRecord {
  customerId: string;
  customerName?: { firstName?: string; lastName?: string };
  companyName?: string;
  contactMethods?: {
    phones?: DriveCustomerPhone[];
    emailAddresses?: DriveCustomerEmail[];
  };
}

interface DriveCustomerContact {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

interface CdkSoughtVehicle {
  isNew?: boolean;
  yearFrom?: number;
  yearTo?: number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  stockNumber?: string;
  isPrimary?: boolean;
}

interface CdkOpportunityItem {
  id: string;
  customer: { id: string };
  dateIn: string;
  source?: string;
  subSource?: string;
  status?: string;
  subStatus?: string;
  upType?: string;
  soughtVehicles?: CdkSoughtVehicle[];
}

interface CdkSearchResponse {
  items: CdkOpportunityItem[];
  totalItems: number;
  totalPages: number;
  pageNumber: number;
  pageSize: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const organizationId = body.organizationId as string | undefined;
    const testMode = body.test === true;
    const previewMode = body.preview === true;
    const dateFrom = body.dateFrom as string | undefined;
    const dateTo = body.dateTo as string | undefined;
    if (!organizationId) return json({ error: 'organizationId is required' }, 400);
    if (!testMode && (!dateFrom || !dateTo)) {
      return json({ error: 'dateFrom and dateTo are required' }, 400);
    }

    const { data: isAdmin } = await userClient.rpc('has_role', {
      _user_id: userRes.user.id,
      _role: 'admin',
    });

    if (!isAdmin) {
      const { data: membership } = await userClient
        .from('user_organizations')
        .select('organization_id')
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (!membership) return json({ error: 'Not a member of this dealership' }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: cred, error: credErr } = await admin
      .from('cdk_fortellis_credentials')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (credErr || !cred) {
      return json({ error: 'No CDK/Fortellis connection configured for this dealership' }, 400);
    }
    if (!cred.is_active) return json({ error: 'CDK/Fortellis connection is deactivated' }, 400);
    if (!cred.token_url) {
      return json({ error: 'token_url is not set — copy it from the Fortellis app\'s Authorization tab' }, 400);
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(cred.token_url, cred.client_id, cred.client_secret);
    } catch (e) {
      await admin.from('cdk_fortellis_credentials').update({
        last_sync_status: `auth error: ${(e as Error).message}`,
      }).eq('id', cred.id);
      return json({ error: `Failed to authorize with Fortellis: ${(e as Error).message}` }, 502);
    }

    if (testMode) {
      return await runConnectionTest(admin, cred, accessToken);
    }

    const items: CdkOpportunityItem[] = [];
    let page = 1;
    let totalPages = 1;

    try {
      do {
        const url = new URL(`${OPPORTUNITIES_SERVICE_URL}/search`);
        url.searchParams.set('dateFrom', dateFrom);
        url.searchParams.set('dateTo', dateTo);
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', String(PAGE_SIZE));

        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Request-Id': crypto.randomUUID(),
            'Subscription-Id': cred.subscription_id,
            Accept: 'application/json',
          },
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Fortellis returned ${res.status}: ${text.slice(0, 300)}`);
        }

        const data = (await res.json()) as CdkSearchResponse;
        items.push(...(data.items ?? []));
        totalPages = data.totalPages ?? 1;
        page += 1;
      } while (page <= totalPages && page <= MAX_PAGES);
    } catch (e) {
      await admin.from('cdk_fortellis_credentials').update({
        last_sync_status: `fetch error: ${(e as Error).message}`,
      }).eq('id', cred.id);
      return json({ error: (e as Error).message }, 502);
    }

    const customerContacts = new Map<string, DriveCustomerContact>();
    if (cred.department_id) {
      const uniqueCustomerIds = Array.from(
        new Set(items.map((i) => i.customer?.id).filter((id): id is string => Boolean(id))),
      ).slice(0, MAX_CUSTOMER_LOOKUPS);

      let cursor = 0;
      const workers = Array.from({ length: CUSTOMER_LOOKUP_CONCURRENCY }, async () => {
        while (cursor < uniqueCustomerIds.length) {
          const customerId = uniqueCustomerIds[cursor++];
          try {
            const contact = await fetchDriveCustomer(
              customerId,
              accessToken,
              cred.subscription_id,
              cred.department_id,
            );
            if (contact) customerContacts.set(customerId, contact);
          } catch {
            // Best-effort enrichment: leave this lead's contact fields blank on failure.
          }
        }
      });
      await Promise.all(workers);
    }

    const leads = items.map((item) => mapLead(item, organizationId, customerContacts));

    if (previewMode) {
      const opportunityIds = leads.map((l) => l.cdk_opportunity_id).filter(Boolean) as string[];
      let alreadyImported = new Set<string>();
      if (opportunityIds.length > 0) {
        const { data: existing } = await admin
          .from('leads')
          .select('cdk_opportunity_id')
          .eq('organization_id', organizationId)
          .in('cdk_opportunity_id', opportunityIds);
        alreadyImported = new Set((existing ?? []).map((r: { cdk_opportunity_id: string }) => r.cdk_opportunity_id));
      }

      const previewItems = leads.map((l) => ({
        ...l,
        isDuplicate: alreadyImported.has(l.cdk_opportunity_id),
      }));

      return json({
        preview: true,
        dateFrom,
        dateTo,
        totalFetched: leads.length,
        newCount: leads.length - alreadyImported.size,
        alreadyImportedCount: alreadyImported.size,
        enriched: customerContacts.size,
        items: previewItems.slice(0, 500),
        truncated: previewItems.length > 500,
      });
    }

    let insertedCount = 0;
    if (leads.length > 0) {
      const { data: inserted, error: insertErr } = await admin
        .from('leads')
        .upsert(leads, { onConflict: 'organization_id,cdk_opportunity_id', ignoreDuplicates: true })
        .select('id');

      if (insertErr) {
        await admin.from('cdk_fortellis_credentials').update({
          last_sync_status: `insert error: ${insertErr.message}`,
        }).eq('id', cred.id);
        return json({ error: insertErr.message }, 500);
      }
      insertedCount = inserted?.length ?? 0;
    }

    const now = new Date().toISOString();
    await admin.from('cdk_fortellis_credentials').update({
      last_synced_at: now,
      last_sync_status: `ok: ${dateFrom} to ${dateTo} — fetched ${items.length}, inserted ${insertedCount}, enriched ${customerContacts.size}`,
    }).eq('id', cred.id);

    return json({
      success: true,
      dateFrom,
      dateTo,
      fetched: items.length,
      inserted: insertedCount,
      skipped: items.length - insertedCount,
      enriched: customerContacts.size,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function getAccessToken(tokenUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token endpoint returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('token endpoint response missing access_token');
  return data.access_token as string;
}

interface CdkCredentialRow {
  id: string;
  client_id: string;
  client_secret: string;
  subscription_id: string;
  token_url: string | null;
  department_id: string | null;
}

// deno-lint-ignore no-explicit-any
async function runConnectionTest(admin: any, cred: CdkCredentialRow, accessToken: string): Promise<Response> {
  // Access token already fetched successfully at this point, so auth is confirmed.
  // Next, confirm the Subscription-Id works against the Opportunities API with a
  // minimal, narrow request -- this doesn't import anything.
  let opportunitiesOk = false;
  let opportunitiesMessage = '';
  let sampleCustomerId: string | null = null;

  try {
    const dateTo = new Date();
    const dateFrom = new Date(dateTo);
    dateFrom.setUTCDate(dateFrom.getUTCDate() - 7);

    const url = new URL(`${OPPORTUNITIES_SERVICE_URL}/search`);
    url.searchParams.set('dateFrom', dateFrom.toISOString());
    url.searchParams.set('dateTo', dateTo.toISOString());
    url.searchParams.set('page', '1');
    url.searchParams.set('pageSize', '1');

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Request-Id': crypto.randomUUID(),
        'Subscription-Id': cred.subscription_id,
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      opportunitiesOk = true;
      const data = (await res.json()) as CdkSearchResponse;
      opportunitiesMessage = `connected — ${data.totalItems ?? 0} opportunit${data.totalItems === 1 ? 'y' : 'ies'} in the last 7 days`;
      sampleCustomerId = data.items?.[0]?.customer?.id ?? null;
    } else {
      const text = await res.text().catch(() => '');
      opportunitiesMessage = `Fortellis returned ${res.status}: ${text.slice(0, 200)}`;
    }
  } catch (e) {
    opportunitiesMessage = (e as Error).message;
  }

  let departmentOk: boolean | null = null;
  let departmentMessage = 'Department ID not set — customer enrichment will be skipped';

  if (cred.department_id) {
    if (!sampleCustomerId) {
      departmentMessage = 'Department ID is set, but no recent opportunity was found to test it against';
    } else {
      try {
        const contact = await fetchDriveCustomer(sampleCustomerId, accessToken, cred.subscription_id, cred.department_id);
        departmentOk = contact !== null;
        departmentMessage = departmentOk
          ? 'connected — customer record retrieved successfully'
          : 'Drive Customer API did not return a record for a sample customer id (check the Department ID)';
      } catch (e) {
        departmentOk = false;
        departmentMessage = (e as Error).message;
      }
    }
  }

  const summary = `test: auth ok; opportunities ${opportunitiesOk ? 'ok' : 'failed'}; department ${departmentOk === null ? 'skipped' : departmentOk ? 'ok' : 'failed'}`;
  await admin.from('cdk_fortellis_credentials').update({ last_sync_status: summary }).eq('id', cred.id);

  return json({
    success: opportunitiesOk,
    authOk: true,
    opportunitiesOk,
    opportunitiesMessage,
    departmentOk,
    departmentMessage,
  });
}

function primarySoughtVehicle(vehicles: CdkSoughtVehicle[] | undefined): CdkSoughtVehicle | null {
  if (!vehicles || vehicles.length === 0) return null;
  return vehicles.find((v) => v.isPrimary) ?? vehicles[0];
}

async function fetchDriveCustomer(
  customerId: string,
  accessToken: string,
  subscriptionId: string,
  departmentId: string,
): Promise<DriveCustomerContact | null> {
  const res = await fetch(`${DRIVE_CUSTOMER_SERVICE_URL}/${encodeURIComponent(customerId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Request-Id': crypto.randomUUID(),
      'Subscription-Id': subscriptionId,
      'Department-Id': departmentId,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;

  const body = await res.json();
  const record = body.data as DriveCustomerRecord | undefined;
  if (!record) return null;

  const firstName = record.customerName?.firstName?.trim() || null;
  const lastName = record.customerName?.lastName?.trim() || null;
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || record.companyName || null;

  const phones = record.contactMethods?.phones ?? [];
  const preferredPhone = phones.find((p) => p.isPrimary) ?? phones.find((p) => p.isPreferred) ?? phones[0];

  const emails = record.contactMethods?.emailAddresses ?? [];
  const preferredEmail = emails.find((e) => e.isPreferred) ?? emails[0];

  return {
    firstName,
    lastName,
    fullName,
    email: preferredEmail?.address ?? null,
    phone: preferredPhone?.number ?? null,
  };
}

function mapLead(
  item: CdkOpportunityItem,
  organizationId: string,
  customerContacts: Map<string, DriveCustomerContact>,
) {
  const vehicle = primarySoughtVehicle(item.soughtVehicles);
  const contact = item.customer?.id ? customerContacts.get(item.customer.id) : undefined;

  return {
    organization_id: organizationId,
    cdk_opportunity_id: item.id,
    lead_date: item.dateIn ?? null,
    source_label: [item.source, item.subSource].filter(Boolean).join(' - ') || item.upType || null,
    vehicle_make: vehicle?.make ?? null,
    vehicle_model: vehicle?.model ?? null,
    vehicle_year: vehicle?.yearFrom ?? vehicle?.yearTo ?? null,
    vin: vehicle?.vin ?? null,
    stock_number: vehicle?.stockNumber ?? null,
    customer_first_name: contact?.firstName ?? null,
    customer_last_name: contact?.lastName ?? null,
    customer_full_name: contact?.fullName ?? null,
    customer_email: contact?.email ?? null,
    customer_phone: contact?.phone ?? null,
    normalized_email: normalizeEmail(contact?.email),
    normalized_phone: normalizePhone(contact?.phone),
    notes: `CDK opportunityId: ${item.id}, customerId: ${item.customer?.id ?? '—'}, status: ${item.status ?? '—'}${item.subStatus ? '/' + item.subStatus : ''}`,
    lead_status: 'new',
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
