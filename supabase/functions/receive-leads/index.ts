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

// Same dedup key shape as src/lib/normalize.ts's buildDedupHash — duplicated
// here because Deno edge functions can't import from src/. Keep in sync.
async function buildDedupHash(parts: {
  email: string | null;
  phone: string | null;
  name: string;
  vehicle: string;
  vin?: string | null;
  stock_number?: string | null;
  lead_date?: string | null;
}): Promise<string> {
  const key = [
    parts.email ?? '',
    parts.phone ?? '',
    parts.name,
    parts.vehicle,
    (parts.vin ?? '').trim().toUpperCase(),
    (parts.stock_number ?? '').trim().toUpperCase(),
    (parts.lead_date ?? '').trim(),
  ].join('|');
  const buf = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function mapLead(raw: Record<string, unknown>, organizationId: string) {
  const firstName = pick(raw.first_name as string, raw.firstName as string, raw.customer_first_name as string);
  const lastName  = pick(raw.last_name  as string, raw.lastName  as string, raw.customer_last_name  as string);
  const fullName  = pick(raw.full_name  as string, raw.fullName  as string, raw.name as string, raw.customer_full_name as string) ??
    ([firstName, lastName].filter(Boolean).join(' ') || null);
  const email = pick(raw.email as string, raw.customer_email as string, raw.email_address as string);
  const phone = pick(raw.phone as string, raw.customer_phone as string, raw.cell_phone as string, raw.cellPhone as string, raw.mobile as string);
  const yearRaw = raw.vehicle_year ?? raw.year ?? raw.vehicleYear;
  const leadDateRaw = pick(raw.lead_date as string, raw.leadDate as string, raw.date as string, raw.created_at as string);
  const vin = pick(raw.vin as string, raw.VIN as string);
  const stockNumber = pick(raw.stock_number as string, raw.stockNumber as string, raw.stock as string);
  const vehicleYear = yearRaw != null ? (Number(yearRaw) || null) : null;
  const vehicleMake = pick(raw.vehicle_make as string, raw.make as string, raw.vehicleMake as string);
  const vehicleModel = pick(raw.vehicle_model as string, raw.model as string, raw.vehicleModel as string);
  const leadDate = leadDateRaw ? (() => { try { return new Date(leadDateRaw).toISOString(); } catch { return null; } })() : null;

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const nameKey = (fullName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const vehicleKey = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ');

  const dedupHash = await buildDedupHash({
    email: normalizedEmail,
    phone: normalizedPhone,
    name: nameKey,
    vehicle: vehicleKey,
    vin,
    stock_number: stockNumber,
    lead_date: leadDate,
  });

  return {
    organization_id:    organizationId,
    customer_first_name: firstName,
    customer_last_name:  lastName,
    customer_full_name:  fullName,
    customer_email:      email,
    customer_phone:      phone,
    normalized_email:    normalizedEmail,
    normalized_phone:    normalizedPhone,
    vin,
    stock_number:  stockNumber,
    vehicle_year:  vehicleYear,
    vehicle_make:  vehicleMake,
    vehicle_model: vehicleModel,
    vehicle_of_interest: pick(raw.vehicle_of_interest as string, raw.vehicleOfInterest as string, raw.vehicle as string),
    source_label:  pick(raw.source as string, raw.source_label as string, raw.sourceLabel as string, raw.lead_source as string, raw.leadSource as string),
    notes:         pick(raw.notes as string, raw.comments as string, raw.description as string),
    lead_date:     leadDate,
    lead_status:   'new',
    dedup_hash:    dedupHash,
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

  const leads = await Promise.all(raw.map(l => mapLead(l, cred.organization_id)));

  // Upsert on the (organization_id, dedup_hash) unique index, same pattern
  // as receive-sales, so re-sending the same lead (or an overlapping batch
  // across two calls) is a safe no-op instead of creating duplicates.
  const { data: upserted, error: upsertErr } = await admin
    .from('leads')
    .upsert(leads, { onConflict: 'organization_id,dedup_hash', ignoreDuplicates: true })
    .select('id');

  if (upsertErr) return json({ error: upsertErr.message }, 500);

  const count = upserted?.length ?? 0;
  await admin.from('api_credentials').update({
    last_used_at: new Date().toISOString(),
    lead_count: cred.lead_count + count,
  }).eq('id', cred.id);

  return json({
    success: true,
    received: raw.length,
    inserted: count,
    duplicates: raw.length - count,
    ids: upserted?.map(r => r.id) ?? [],
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
