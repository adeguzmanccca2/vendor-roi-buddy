// Public webhook endpoint for receiving sales records — meant for a scheduled
// script (curl/PowerShell/Task Scheduler) on the dealership side, as an alternative
// to manual CSV upload or FTP.
// Auth: x-api-key header matched against api_credentials table (same key as receive-leads).
// Accepts a single sale object, an array, or { sales: [...] }.
//
// Deno edge functions can't import from src/, so normalize.ts's helpers are duplicated
// here. Keep in sync with src/lib/normalize.ts and receive-leads/index.ts.
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

function normalizeRevenue(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const isNeg = /^\(.*\)$/.test(raw) || raw.includes('-');
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return isNeg ? -n : n;
}

function parseSaleDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const [, mm, dd, yy] = m;
    const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
    const dt = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  return null;
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function parseVehicle(text: string | null): { year: number | null; make: string | null; model: string | null } {
  if (!text) return { year: null, make: null, model: null };
  const s = text.trim();
  const yearMatch = s.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  const rest = yearMatch ? s.replace(yearMatch[0], '').trim() : s;
  const tokens = rest.split(/\s+/).filter(Boolean);
  const make = tokens[0] ?? null;
  const model = tokens.length > 1 ? tokens.slice(1).join(' ') : null;
  return { year, make, model };
}

async function buildDedupHash(parts: {
  email: string | null;
  phone: string | null;
  name: string;
  vehicle: string;
  vin?: string | null;
  stock_number?: string | null;
  sale_date?: string | null;
}): Promise<string> {
  const key = [
    parts.email ?? '',
    parts.phone ?? '',
    parts.name,
    parts.vehicle,
    (parts.vin ?? '').trim().toUpperCase(),
    (parts.stock_number ?? '').trim().toUpperCase(),
    (parts.sale_date ?? '').trim(),
  ].join('|');
  const buf = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function pick(...args: (string | number | null | undefined)[]): string | null {
  for (const a of args) if (a != null && String(a).trim() !== '') return String(a).trim();
  return null;
}

async function mapSale(raw: Record<string, unknown>, organizationId: string) {
  const firstName = pick(raw.first_name as string, raw.firstName as string, raw.customer_first_name as string);
  const lastName  = pick(raw.last_name  as string, raw.lastName  as string, raw.customer_last_name  as string);
  const fullName  = pick(raw.full_name as string, raw.fullName as string, raw.name as string, raw.customer_full_name as string) ??
    ([firstName, lastName].filter(Boolean).join(' ') || null);
  const split = !firstName && !lastName ? splitName(fullName) : { first: firstName, last: lastName };

  const email = pick(raw.email as string, raw.customer_email as string, raw.email_address as string);
  const phone = pick(raw.phone as string, raw.customer_phone as string, raw.cell_phone as string, raw.cellPhone as string, raw.mobile as string);

  const vin = pick(raw.vin as string, raw.VIN as string);
  const stockNumber = pick(raw.stock_number as string, raw.stockNumber as string, raw.stock as string);

  const vehicleText = pick(raw.vehicle as string, raw.vehicle_of_interest as string, raw.vehicleOfInterest as string);
  const parsedVehicle = parseVehicle(vehicleText);
  const yearRaw = raw.vehicle_year ?? raw.year ?? raw.vehicleYear;
  const vehicleYear = yearRaw != null ? (Number(yearRaw) || null) : parsedVehicle.year;
  const vehicleMake = pick(raw.vehicle_make as string, raw.make as string, raw.vehicleMake as string) ?? parsedVehicle.make;
  const vehicleModel = pick(raw.vehicle_model as string, raw.model as string, raw.vehicleModel as string) ?? parsedVehicle.model;

  const saleDateRaw = pick(raw.sale_date as string, raw.saleDate as string, raw.date_sold as string, raw.close_date as string, raw.date as string);
  const saleDate = parseSaleDate(saleDateRaw);

  const priceRaw = pick(
    raw.gross_revenue as string, raw.total_gross as string, raw.sale_price as string,
    raw.salePrice as string, raw.price as string, raw.amount as string,
  );
  const price = normalizeRevenue(priceRaw);
  const frontGross = normalizeRevenue(pick(raw.front_gross as string, raw.frontGross as string));
  const backGross = normalizeRevenue(pick(raw.back_gross as string, raw.backGross as string));

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
    sale_date: saleDate,
  });

  return {
    organization_id: organizationId,
    customer_first_name: split.first,
    customer_last_name: split.last,
    customer_full_name: fullName,
    customer_email: email,
    customer_phone: phone,
    normalized_email: normalizedEmail,
    normalized_phone: normalizedPhone,
    vin,
    stock_number: stockNumber,
    deal_number: pick(raw.deal_number as string, raw.dealNumber as string, raw.dms_deal_id as string),
    salesperson: pick(raw.salesperson as string, raw.sales_rep as string, raw.salesRep as string),
    sale_date: saleDate ?? new Date().toISOString(),
    vehicle_year: vehicleYear,
    vehicle_make: vehicleMake,
    vehicle_model: vehicleModel,
    gross_revenue: price ?? 0,
    front_gross: frontGross ?? 0,
    back_gross: backGross ?? 0,
    total_gross: price ?? 0,
    sale_price: price,
    new_used: pick(raw.new_used as string, raw.newUsed as string, raw.condition as string),
    source_label: pick(raw.source as string, raw.source_label as string, raw.sourceLabel as string, raw.lead_source as string),
    notes: pick(raw.notes as string, raw.comments as string),
    attribution_status: 'unmatched',
    manual_override: false,
    dedup_hash: dedupHash,
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
    .select('id, organization_id, is_active, sale_count')
    .eq('api_key', apiKey)
    .maybeSingle();

  if (credErr || !cred) return json({ error: 'Invalid API key' }, 401);
  if (!cred.is_active) return json({ error: 'This API key has been deactivated' }, 403);

  let body: Record<string, unknown> | unknown[];
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const raw: Record<string, unknown>[] = Array.isArray(body)
    ? body as Record<string, unknown>[]
    : Array.isArray((body as Record<string, unknown>).sales)
      ? (body as Record<string, unknown>).sales as Record<string, unknown>[]
      : [body as Record<string, unknown>];

  if (raw.length === 0) return json({ error: 'No sales provided' }, 400);
  if (raw.length > 1000) return json({ error: 'Maximum 1000 sales per request' }, 400);

  const sales = await Promise.all(raw.map(s => mapSale(s, cred.organization_id)));

  // Upsert on the (organization_id, dedup_hash) unique index so re-sending the same
  // file (or overlapping rows across two runs a day) is a safe no-op instead of a dupe.
  const { data: upserted, error: upsertErr } = await admin
    .from('sales')
    .upsert(sales, { onConflict: 'organization_id,dedup_hash', ignoreDuplicates: true })
    .select('id');

  if (upsertErr) return json({ error: upsertErr.message }, 500);

  const insertedCount = upserted?.length ?? 0;

  await admin.rpc('attribute_sales_for_org', { _org_id: cred.organization_id });

  await admin.from('api_credentials').update({
    last_used_at: new Date().toISOString(),
    sale_count: cred.sale_count + insertedCount,
  }).eq('id', cred.id);

  return json({
    success: true,
    received: raw.length,
    inserted: insertedCount,
    duplicates: raw.length - insertedCount,
    ids: upserted?.map(r => r.id) ?? [],
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
