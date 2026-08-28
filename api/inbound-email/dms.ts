// ============================================================================
// POSTMARK SETUP:
// 1. In the Postmark dashboard -> your inbound stream -> Settings.
// 2. Add an "Inbound Secret" (any random string) and save the SAME value as
//    POSTMARK_INBOUND_SECRET in Vercel -> Project Settings -> Environment
//    Variables (this is separate from Supabase's edge-function secrets store).
// 3. Webhook URL: https://roi.autoadvisoragent.com/api/inbound-email/dms
// 4. Custom Inbound Domain: dms.autoadvisoragent.com
// 5. To test: send an email with a CSV or Excel attachment to
//    test@dms.autoadvisoragent.com from an address whose domain is mapped in
//    api_credentials.sender_domain (see migration
//    20260826000000_inbound_email_import.sql — this is NOT a hardcoded map,
//    it's a column on the existing api_credentials table, e.g.:
//      UPDATE api_credentials SET sender_domain = 'bayshorefordinc.com'
//      WHERE id = '<the credential row for Bayshore Ford>';
//
// Also required in Vercel's env vars (this function runs on Vercel, not
// Supabase, so it does NOT automatically inherit the Supabase edge functions'
// secrets — these must be added separately even though some names match):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY,
//   POSTMARK_INBOUND_SECRET, DMS_IMPORT_NOTIFY_EMAIL
// ============================================================================
//
// WHY this file exists: dealership IT (e.g. Bayshore) already has a DMS export
// job that can email a CSV. Rather than asking them to learn an API or find an
// FTP server we don't have, we give them an email address. Postmark receives
// that email and POSTs its parsed contents here. This route turns that POST
// into the same `sales` upsert + attribution flow already used by the
// receive-sales webhook (supabase/functions/receive-sales/index.ts) — no
// Node-callable "existing import pipeline" existed to reuse (see Phase 0
// audit: all three CSV upload pages are browser-only, tied to FileReader/File
// DOM APIs), so this ports receive-sales's row-mapping/dedup/attribution
// logic into a CSV/Excel-aware Node function instead of duplicating it a
// third time with different behavior.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  normalizeEmail,
  normalizePhone,
  normalizeRevenue,
  parseLeadDate,
  parseVehicle,
  splitName,
  buildDedupHash,
// WHY the .js extension on a .ts source file: this function runs under
// Node's native ESM loader on Vercel (package.json has "type": "module")
// rather than being bundled into a single file, so relative imports are
// resolved by Node at runtime against the compiled output — which is
// .js — not by TypeScript at build time. Omitting the extension caused
// ERR_MODULE_NOT_FOUND in production even though local dev/typecheck
// didn't catch it.
} from '../../src/lib/normalize.js';

// ----------------------------------------------------------------------------
// Postmark inbound payload (subset of fields we actually use)
// ----------------------------------------------------------------------------
interface PostmarkAttachment {
  Name: string;
  Content: string; // base64
  ContentType: string;
  ContentLength: number;
}

interface PostmarkInboundPayload {
  From: string;
  Subject?: string;
  Date?: string;
  Attachments?: PostmarkAttachment[];
}

// ----------------------------------------------------------------------------
// WHY: sender -> org mapping lives in the DB (api_credentials.sender_domain)
// instead of a hardcoded map, so whitelisting a new dealership's export
// address is a SQL update, not a code deploy. See the migration for the
// unique index backing this lookup.
// ----------------------------------------------------------------------------
function extractDomain(fromHeader: string): string | null {
  const match = fromHeader.match(/[^<\s@]+@([^\s>]+)/);
  return match ? match[1].toLowerCase() : null;
}

function pick(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

// DMS exports vary in header casing/spacing ("Sale Date", "sale_date",
// "SaleDate"). Normalize every row's keys once so pick() can use plain
// snake_case aliases regardless of how the source file spelled them.
function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    out[key] = v;
  }
  return out;
}

interface EmailCredential {
  id: string;
  organization_id: string;
  sale_count: number;
  location_label: string | null;
}

function rowLocation(row: Record<string, unknown>): string | null {
  return pick(row, 'location', 'store', 'rooftop', 'dealership_location', 'dealership');
}

// WHY case-insensitive exact match, not fuzzy: location_label is set
// deliberately per credential row (see migration
// 20260828000000_multi_location_email_routing.sql) specifically so it can
// be matched exactly against whatever value the dealership's export uses —
// fuzzy matching here would risk silently routing a row to the wrong
// dealership, which is worse than rejecting an unmatched row outright.
function matchCredentialByLocation(creds: EmailCredential[], location: string | null): EmailCredential | null {
  if (!location) return null;
  const target = location.trim().toLowerCase();
  return creds.find(c => (c.location_label ?? '').trim().toLowerCase() === target) ?? null;
}

// WHY row is pre-normalized: the handler needs each row's normalized keys
// once anyway (to read 'location' for multi-org routing before we know
// which organizationId to map into), so normalizeRowKeys is called there
// and passed in here instead of duplicating the call per row.
async function mapSaleRow(row: Record<string, unknown>, organizationId: string) {
  const firstName = pick(row, 'first_name', 'customer_first_name');
  const lastName = pick(row, 'last_name', 'customer_last_name');
  const fullNamePicked = pick(row, 'full_name', 'name', 'customer_full_name', 'customer_name');
  const fullName = fullNamePicked ?? ([firstName, lastName].filter(Boolean).join(' ') || null);
  const split = !firstName && !lastName ? splitName(fullName) : { first: firstName, last: lastName };

  const email = pick(row, 'email', 'customer_email', 'email_address');
  const phone = pick(row, 'phone', 'customer_phone', 'cell_phone', 'mobile');

  const vin = pick(row, 'vin');
  const stockNumber = pick(row, 'stock_number', 'stock', 'stock_no');

  const vehicleText = pick(row, 'vehicle', 'vehicle_of_interest');
  const parsedVehicle = parseVehicle(vehicleText);
  const yearRaw = pick(row, 'vehicle_year', 'year');
  const vehicleYear = yearRaw != null ? (Number(yearRaw) || null) : parsedVehicle.year;
  const vehicleMake = pick(row, 'vehicle_make', 'make') ?? parsedVehicle.make;
  const vehicleModel = pick(row, 'vehicle_model', 'model') ?? parsedVehicle.model;

  const saleDateRaw = pick(row, 'sale_date', 'date_sold', 'close_date', 'closed_date', 'date');
  const saleDate = parseLeadDate(saleDateRaw);

  const priceRaw = pick(row, 'gross_revenue', 'total_gross', 'sale_price', 'price', 'amount');
  const price = normalizeRevenue(priceRaw);
  const frontGross = normalizeRevenue(pick(row, 'front_gross'));
  const backGross = normalizeRevenue(pick(row, 'back_gross'));

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
    lead_date: saleDate,
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
    deal_number: pick(row, 'deal_number', 'dms_deal_id'),
    salesperson: pick(row, 'salesperson', 'sales_rep'),
    sale_date: saleDate ?? new Date().toISOString(),
    vehicle_year: vehicleYear,
    vehicle_make: vehicleMake,
    vehicle_model: vehicleModel,
    gross_revenue: price ?? 0,
    front_gross: frontGross ?? 0,
    back_gross: backGross ?? 0,
    total_gross: price ?? 0,
    sale_price: price,
    new_used: pick(row, 'new_used', 'condition'),
    source_label: pick(row, 'source', 'source_label', 'lead_source'),
    notes: pick(row, 'notes', 'comments'),
    attribution_status: 'unmatched',
    manual_override: false,
    dedup_hash: dedupHash,
  };
}

// ----------------------------------------------------------------------------
// Parse the decoded attachment buffer into row objects. CSV goes through
// papaparse (same library the browser upload pages use, just fed a string
// instead of a File). Excel goes through xlsx (SheetJS) — no Excel parser
// existed anywhere in this repo before this route; the browser upload pages
// explicitly reject .xlsx/.xls today.
// ----------------------------------------------------------------------------
function parseAttachmentRows(filename: string, buffer: Buffer): Record<string, unknown>[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    const result = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
    return result.data;
  }
  // .xlsx / .xls
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
}

// ----------------------------------------------------------------------------
// Brevo email helper — same API/pattern as
// supabase/functions/invite-user/index.ts's sendBrevoEmail, ported to Node
// fetch (no Deno-specific APIs used there, so this is a straight port).
// ----------------------------------------------------------------------------
async function sendBrevoEmail(params: {
  apiKey: string;
  to: string[];
  subject: string;
  html: string;
}): Promise<{ sent: boolean; error: string | null }> {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': params.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Vendor ROI', email: 'noreply@logos-tek.com' },
        to: params.to.map(email => ({ email })),
        subject: params.subject,
        htmlContent: params.html,
      }),
    });
    const responseText = await res.text();
    if (!res.ok) return { sent: false, error: `Brevo HTTP ${res.status}: ${responseText}` };
    return { sent: true, error: null };
  } catch (e) {
    return { sent: false, error: `fetch error: ${(e as Error).name}: ${(e as Error).message}` };
  }
}

function formatSubjectTimestamp(d: Date): string {
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${datePart} ${hours}:${minutes}${ampm}`;
}

function plainTextEmailHtml(lines: string[]): string {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;white-space:pre-line">${lines.join('\n')}</div>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ---- Step 1: verify the request is actually from Postmark -------------
  // WHY: this endpoint is public. Without validation, anyone who discovers
  // the URL can POST fake payloads and trigger imports. A shared secret
  // stops casual abuse (Postmark inbound webhooks aren't signed by default).
  const expectedSecret = process.env.POSTMARK_INBOUND_SECRET;
  if (!expectedSecret) {
    console.error('[inbound-email/dms] POSTMARK_INBOUND_SECRET is not configured');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }
  const providedSecret = req.headers['x-postmark-inbound-secret'];
  if (!providedSecret || providedSecret !== expectedSecret) {
    console.warn('[inbound-email/dms] rejected request: missing/invalid inbound secret', {
      hasHeader: providedSecret != null,
    });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = req.body as PostmarkInboundPayload;
  const fromHeader = payload?.From ?? '';

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoApiKey = process.env.BREVO_API_KEY;
  const notifyEmail = process.env.DMS_IMPORT_NOTIFY_EMAIL;
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://roi.autoadvisoragent.com';

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[inbound-email/dms] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // ---- Step 2: identify the dealership(s) via sender domain --------------
  // A domain can now resolve to more than one credential/org — a
  // multi-location dealer group (e.g. Bayshore Ford + Bayshore Trucks)
  // sharing one export mailbox, disambiguated per-row by 'location' (see
  // migration 20260828000000_multi_location_email_routing.sql). A
  // single-location domain still has exactly one row and behaves as before.
  const domain = extractDomain(fromHeader);
  const { data: credsData, error: credErr } = domain
    ? await admin
        .from('api_credentials')
        .select('id, organization_id, sale_count, location_label')
        .eq('sender_domain', domain)
        .eq('is_active', true)
    : { data: null, error: null };

  if (credErr) {
    console.error('[inbound-email/dms] api_credentials lookup failed', credErr.message);
    res.status(500).json({ error: credErr.message });
    return;
  }

  if (!credsData || credsData.length === 0) {
    // WHY return 200 for unknown senders: Postmark retries on non-2xx
    // responses. An unknown sender isn't Postmark's fault — returning 200
    // stops the retry loop while we investigate.
    console.warn('[inbound-email/dms] unknown sender', { from: fromHeader, domain });
    res.status(200).json({ success: false, reason: 'unknown_sender' });
    return;
  }

  const creds = credsData as EmailCredential[];
  const multiLocation = creds.length > 1;
  const receivedAt = payload.Date ? new Date(payload.Date) : new Date();
  const subjectTimestamp = formatSubjectTimestamp(receivedAt);

  let summaryLabel: string;
  if (multiLocation) {
    summaryLabel = `${domain} (${creds.length} locations)`;
  } else {
    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', creds[0].organization_id)
      .maybeSingle();
    summaryLabel = org?.name ?? 'Unknown dealership';
  }

  // ---- Step 3: extract the attachment ------------------------------------
  const attachment = (payload.Attachments ?? []).find(a =>
    /\.(csv|xlsx|xls)$/i.test(a.Name ?? ''),
  );

  if (!attachment) {
    console.warn('[inbound-email/dms] no CSV/Excel attachment found', { from: fromHeader });

    if (brevoApiKey && notifyEmail) {
      await sendBrevoEmail({
        apiKey: brevoApiKey,
        to: [notifyEmail],
        subject: `⚠️ DMS Email Received (No Attachment) — ${summaryLabel} — ${subjectTimestamp}`,
        html: plainTextEmailHtml([
          `Email received from: ${fromHeader}`,
          `Subject: ${payload.Subject ?? '(none)'}`,
          '',
          'No CSV or Excel attachment was found on this email — the DMS export job may have failed silently.',
        ]),
      });
    }

    // WHY logged against creds[0]'s org: this is a domain-level failure
    // (no file at all), not specific to one location, and there's no
    // "ambiguous/unassigned" org to log against instead.
    await admin.from('dms_import_logs').insert({
      organization_id: creds[0].organization_id,
      filename: null,
      sender_email: fromHeader,
      rows_imported: 0,
      duplicates_skipped: 0,
      error_count: 1,
      raw_errors: ['No CSV/Excel attachment found on inbound email'],
      received_at: receivedAt.toISOString(),
      processed_at: new Date().toISOString(),
      status: 'failed',
    });

    res.status(200).json({ success: false, reason: 'no_attachment' });
    return;
  }

  // ---- Step 4: run the import pipeline -----------------------------------
  // Single-location domain: every row maps to that one org (unchanged
  // behavior). Multi-location domain: each row must carry a 'location'
  // value matching one credential's location_label; rows with no match
  // are rejected rather than silently routed to the wrong dealership.
  interface OrgResult { rowsImported: number; duplicatesSkipped: number; errors: string[] }
  const resultsByCredId = new Map<string, OrgResult>();
  for (const c of creds) resultsByCredId.set(c.id, { rowsImported: 0, duplicatesSkipped: 0, errors: [] });
  const unmatchedLocationErrors: string[] = [];

  try {
    const buffer = Buffer.from(attachment.Content, 'base64');
    const rawRows = parseAttachmentRows(attachment.Name, buffer);
    const normalizedRows = rawRows.map(normalizeRowKeys);

    if (normalizedRows.length === 0) {
      resultsByCredId.get(creds[0].id)!.errors.push('Attachment parsed but contained 0 rows');
    } else if (!multiLocation) {
      const mappedRows = await Promise.all(normalizedRows.map(r => mapSaleRow(r, creds[0].organization_id)));
      const result = resultsByCredId.get(creds[0].id)!;
      // Same dedup strategy as receive-sales: upsert on the
      // (organization_id, dedup_hash) unique index so re-sending the same
      // file (or a file with overlapping rows from a prior run) is a safe
      // no-op instead of creating duplicate sales.
      const { data: upserted, error: upsertErr } = await admin
        .from('sales')
        .upsert(mappedRows, { onConflict: 'organization_id,dedup_hash', ignoreDuplicates: true })
        .select('id');
      if (upsertErr) {
        result.errors.push(upsertErr.message);
      } else {
        result.rowsImported = upserted?.length ?? 0;
        result.duplicatesSkipped = mappedRows.length - result.rowsImported;
      }
    } else {
      // Group rows by matched credential/location, then upsert per org so
      // one bad row in one location can't block the other location's rows.
      const rowsByCredId = new Map<string, Record<string, unknown>[]>();
      for (const c of creds) rowsByCredId.set(c.id, []);
      const knownLocations = creds.map(c => c.location_label).filter(Boolean).join(', ');
      normalizedRows.forEach((row, idx) => {
        const location = rowLocation(row);
        const match = matchCredentialByLocation(creds, location);
        if (!match) {
          const label = location ? `"${location}"` : '(missing)';
          unmatchedLocationErrors.push(
            `Row ${idx + 1}: location ${label} did not match any known location (${knownLocations})`,
          );
          return;
        }
        rowsByCredId.get(match.id)!.push(row);
      });

      for (const c of creds) {
        const rows = rowsByCredId.get(c.id)!;
        if (rows.length === 0) continue;
        const mappedRows = await Promise.all(rows.map(r => mapSaleRow(r, c.organization_id)));
        const result = resultsByCredId.get(c.id)!;
        const { data: upserted, error: upsertErr } = await admin
          .from('sales')
          .upsert(mappedRows, { onConflict: 'organization_id,dedup_hash', ignoreDuplicates: true })
          .select('id');
        if (upsertErr) {
          result.errors.push(upsertErr.message);
        } else {
          result.rowsImported = upserted?.length ?? 0;
          result.duplicatesSkipped = mappedRows.length - result.rowsImported;
        }
      }
    }
  } catch (e) {
    resultsByCredId.get(creds[0].id)!.errors.push((e as Error).message);
  }

  // Attribute + update usage stats only for orgs that actually got rows.
  for (const c of creds) {
    const result = resultsByCredId.get(c.id)!;
    if (result.rowsImported > 0) {
      await admin.rpc('attribute_sales_for_org', { _org_id: c.organization_id });
      await admin
        .from('api_credentials')
        .update({ last_used_at: new Date().toISOString(), sale_count: c.sale_count + result.rowsImported })
        .eq('id', c.id);
    }
  }

  // ---- Step 6: log the import — one row per org that had activity, plus
  // a shared row (against the first credential) for any rows that couldn't
  // be matched to a location -------------------------------------------------
  for (const c of creds) {
    const result = resultsByCredId.get(c.id)!;
    if (result.rowsImported === 0 && result.duplicatesSkipped === 0 && result.errors.length === 0) continue;
    const status: 'success' | 'partial' | 'failed' =
      result.errors.length > 0 && result.rowsImported === 0 ? 'failed' : result.errors.length > 0 ? 'partial' : 'success';
    await admin.from('dms_import_logs').insert({
      organization_id: c.organization_id,
      filename: attachment.Name,
      sender_email: fromHeader,
      rows_imported: result.rowsImported,
      duplicates_skipped: result.duplicatesSkipped,
      error_count: result.errors.length,
      raw_errors: result.errors,
      received_at: receivedAt.toISOString(),
      processed_at: new Date().toISOString(),
      status,
    });
  }
  if (unmatchedLocationErrors.length > 0) {
    await admin.from('dms_import_logs').insert({
      organization_id: creds[0].organization_id,
      filename: attachment.Name,
      sender_email: fromHeader,
      rows_imported: 0,
      duplicates_skipped: 0,
      error_count: unmatchedLocationErrors.length,
      raw_errors: unmatchedLocationErrors,
      received_at: receivedAt.toISOString(),
      processed_at: new Date().toISOString(),
      status: 'partial',
    });
  }

  const totalRowsImported = [...resultsByCredId.values()].reduce((s, r) => s + r.rowsImported, 0);
  const totalDuplicatesSkipped = [...resultsByCredId.values()].reduce((s, r) => s + r.duplicatesSkipped, 0);
  const totalErrors = [...resultsByCredId.values()].flatMap(r => r.errors).concat(unmatchedLocationErrors);
  const overallStatus: 'success' | 'partial' | 'failed' =
    totalErrors.length > 0 && totalRowsImported === 0 ? 'failed' : totalErrors.length > 0 ? 'partial' : 'success';

  // ---- Step 5: send confirmation/failure email -----------------------------
  if (brevoApiKey && notifyEmail) {
    const ok = overallStatus !== 'failed';
    const subject = ok
      ? `✅ DMS Import Complete — ${summaryLabel} — ${subjectTimestamp}`
      : `❌ DMS Import Failed — ${summaryLabel} — ${subjectTimestamp}`;
    const perLocationLines = multiLocation
      ? creds.map(c => {
          const r = resultsByCredId.get(c.id)!;
          return `  - ${c.location_label ?? c.organization_id}: ${r.rowsImported} imported, ${r.duplicatesSkipped} duplicates, ${r.errors.length} errors`;
        })
      : [];
    const html = plainTextEmailHtml([
      `Import received from: ${fromHeader}`,
      `File: ${attachment.Name}`,
      ...(multiLocation ? ['By location:', ...perLocationLines] : []),
      `Rows imported: ${totalRowsImported}`,
      `Duplicates skipped: ${totalDuplicatesSkipped}`,
      `Errors: ${totalErrors.length}${totalErrors.length ? '\n  - ' + totalErrors.join('\n  - ') : ''}`,
      '',
      `View dashboard: ${dashboardUrl}`,
    ]);
    await sendBrevoEmail({ apiKey: brevoApiKey, to: [notifyEmail], subject, html });
  }

  // WHY always 200 here: we've already sent the alert/confirmation email and
  // written the audit log — Postmark retrying a failed import won't fix a
  // bad file, it'll just resend the same broken attachment.
  res.status(200).json({
    success: overallStatus !== 'failed',
    status: overallStatus,
    filename: attachment.Name,
    rowsImported: totalRowsImported,
    duplicatesSkipped: totalDuplicatesSkipped,
    errors: totalErrors,
    ...(multiLocation
      ? {
          byLocation: creds.map(c => ({
            organizationId: c.organization_id,
            location: c.location_label,
            ...resultsByCredId.get(c.id)!,
          })),
        }
      : {}),
  });
}
