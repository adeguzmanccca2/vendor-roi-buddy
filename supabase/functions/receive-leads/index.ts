// Public webhook endpoint for receiving leads from external CRMs.
// Auth: x-api-key header matched against api_credentials table.
// Accepts a single lead object, an array, or { leads: [...] }.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function pick(...args: (string | null | undefined)[]): string | null {
  for (const a of args) if (a != null && String(a).trim() !== '') return String(a).trim();
  return null;
}

function mapLead(raw: Record<string, unknown>, organizationId: string) {
  const firstName = pick(raw.first_name as string, raw.firstName as string, raw.customer_first_name as string);
  const lastName  = pick(raw.last_name  as string, raw.lastName  as string, raw.customer_last_name  as string);
  const fullName  = pick(raw.full_name  as string, raw.fullName  as string, raw.name as string, raw.customer_full_name as string) ??
    ([firstName, lastName].filter(Boolean).join(' ') || null);
  const email = pick(raw.email as string, raw.customer_email as string, raw.email_address as string);
  const phone = pick(raw.phone as string, raw.customer_phone as string, raw.cell_phone as string, raw.cellPhone as string, raw.mobile as string);
  const yearRaw = raw.vehicle_year ?? raw.year ?? raw.vehicleYear;
  const leadDateRaw = pick(raw.lead_date as string, raw.leadDate as string, raw.date as string, raw.created_at as string);

  return {
    organization_id:    organizationId,
    customer_first_name: firstName,
    customer_last_name:  lastName,
    customer_full_name:  fullName,
    customer_email:      email,
    customer_phone:      phone,
    normalized_email:    normalizeEmail(email),
    normalized_phone:    normalizePhone(phone),
    vin:           pick(raw.vin as string, raw.VIN as string),
    stock_number:  pick(raw.stock_number as string, raw.stockNumber as string, raw.stock as string),
    vehicle_year:  yearRaw != null ? (Number(yearRaw) || null) : null,
    vehicle_make:  pick(raw.vehicle_make as string, raw.make as string, raw.vehicleMake as string),
    vehicle_model: pick(raw.vehicle_model as string, raw.model as string, raw.vehicleModel as string),
    vehicle_of_interest: pick(raw.vehicle_of_interest as string, raw.vehicleOfInterest as string, raw.vehicle as string),
    source_label:  pick(raw.source as string, raw.source_label as string, raw.sourceLabel as string, raw.lead_source as string, raw.leadSource as string),
    notes:         pick(raw.notes as string, raw.comments as string, raw.description as string),
    lead_date:     leadDateRaw ? (() => { try { return new Date(leadDateRaw).toISOString(); } catch { return null; } })() : null,
    lead_status:   'new',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey =
    req.headers.get('x-api-key') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!apiKey) return json({ error: 'API key required — pass via x-api-key header' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: cred, error: credErr } = await admin
    .from('api_credentials')
    .select('id, organization_id, is_active, lead_count')
    .eq('api_key', apiKey)
    .maybeSingle();

  if (credErr || !cred) return json({ error: 'Invalid API key' }, 401);
  if (!cred.is_active) return json({ error: 'This API key has been deactivated' }, 403);

  let body: Record<string, unknown> | unknown[];
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const raw: Record<string, unknown>[] = Array.isArray(body)
    ? body as Record<string, unknown>[]
    : Array.isArray((body as Record<string, unknown>).leads)
      ? (body as Record<string, unknown>).leads as Record<string, unknown>[]
      : [body as Record<string, unknown>];

  if (raw.length === 0) return json({ error: 'No leads provided' }, 400);
  if (raw.length > 500) return json({ error: 'Maximum 500 leads per request' }, 400);

  const leads = raw.map(l => mapLead(l, cred.organization_id));

  const { data: inserted, error: insertErr } = await admin
    .from('leads')
    .insert(leads)
    .select('id');

  if (insertErr) return json({ error: insertErr.message }, 500);

  const count = inserted?.length ?? 0;
  await admin.from('api_credentials').update({
    last_used_at: new Date().toISOString(),
    lead_count: cred.lead_count + count,
  }).eq('id', cred.id);

  return json({ success: true, inserted: count, ids: inserted?.map(r => r.id) ?? [] });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
