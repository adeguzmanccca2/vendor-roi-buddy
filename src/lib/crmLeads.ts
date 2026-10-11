// CRM lead import -- shared by the CRM Leads Upload page and the inbound
// email route (api/inbound-email/dms.ts), so both apply the same rules.
//
// A CRM export lists the leads salespeople entered, each with a "Lead
// Provider". For every row:
//   1. Lead Provider -> vendor via source_mapping_rules. A rule with no
//      vendor is a SKIP rule (e.g. "Service"); no rule at all = Unassigned.
//   2. If the same person is already a lead for that vendor (email, phone,
//      VIN or stock # match, the existing lead dated inside the file's own
//      date range and within 30 days of the row), don't add a second lead --
//      fill any blank fields on the existing one instead.
//   3. Otherwise insert it as a new lead with lead_origin = 'crm'.
//
// WHY the .js extension: this file is also loaded by the Vercel Node
// function under Node's native ESM loader (see the note in dms.ts).
import {
  buildDedupHash,
  guessColumn,
  normalizeEmail,
  normalizePhone,
  parseLeadDate,
  parseVehicle,
  splitName,
} from './normalize.js';

export const CRM_MATCH_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Lead Provider -> vendor
// ---------------------------------------------------------------------------
export interface SourceRule {
  pattern: string;
  match_type: string; // 'exact' | 'contains'
  priority: number;
  is_active: boolean;
  vendor_id: string | null; // null = skip rule
}

export type ProviderResolution =
  | { kind: 'vendor'; vendorId: string }
  | { kind: 'skip' }
  | { kind: 'unmapped' };

// Same semantics as apply_source_mapping_for_org: case-insensitive, lowest
// priority number wins, and at equal priority an exact rule beats contains.
export function resolveProvider(provider: string | null, rules: SourceRule[]): ProviderResolution {
  const p = (provider ?? '').trim().toLowerCase();
  if (!p) return { kind: 'unmapped' };
  const match = rules
    .filter(r => r.is_active)
    .filter(r => {
      const pat = r.pattern.trim().toLowerCase();
      if (!pat) return false;
      return r.match_type === 'exact' ? p === pat : p.includes(pat);
    })
    .sort((a, b) => a.priority - b.priority || Number(b.match_type === 'exact') - Number(a.match_type === 'exact'))[0];
  if (!match) return { kind: 'unmapped' };
  return match.vendor_id ? { kind: 'vendor', vendorId: match.vendor_id } : { kind: 'skip' };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export interface CrmLeadRow {
  rowNumber: number; // as the user sees it in the file (header = row 1)
  provider: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  vin: string | null;
  stock: string | null;
  vehicle: string | null;
  // Separate vehicle columns (e.g. eLead's "Wanted Veh Year/Make/Model");
  // they win over whatever parsing `vehicle` would give.
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleTrim: string | null;
  // New/Used -- part of what makes two wanted vehicles different.
  vehicleCondition: string | null;
  leadDate: string | null; // ISO
  notes: string | null;
}

// ---------------------------------------------------------------------------
// File columns -> CrmLeadRow
// ---------------------------------------------------------------------------
// Candidates are tried in order (exact header first, then word match; see
// guessColumn). Snake_case variants cover exports that already use them.
export const CRM_FIELDS = [
  { key: 'provider',   label: 'Lead Provider', required: true,  candidates: ['lead provider', 'lead_provider', 'leadprovider', 'provider', 'lead source', 'lead_source'] },
  { key: 'lead_date',  label: 'Lead date',     required: false, candidates: ['lead date', 'lead_date', 'date in', 'date_in', 'date created', 'created date', 'create date', 'created', 'date'] },
  { key: 'full_name',  label: 'Customer name', required: false, candidates: ['customer name', 'customer_name', 'full name', 'full_name', 'name', 'customer'] },
  { key: 'first_name', label: 'First name',    required: false, candidates: ['first name', 'first_name', 'firstname'] },
  { key: 'last_name',  label: 'Last name',     required: false, candidates: ['last name', 'last_name', 'lastname'] },
  { key: 'email',      label: 'Email',         required: false, candidates: ['email', 'e-mail', 'email address', 'email_address'] },
  { key: 'phone',      label: 'Phone',         required: false, candidates: ['cell phone', 'cell_phone', 'mobile', 'cell', 'phone'] },
  // Used only when the row's main phone is blank.
  { key: 'home_phone', label: 'Home phone (fallback)', required: false, candidates: ['home phone', 'home_phone'] },
  { key: 'work_phone', label: 'Work phone (fallback)', required: false, candidates: ['work phone', 'work_phone'] },
  { key: 'vin',        label: 'VIN',           required: false, candidates: ['vin', 'vin #', 'vin number'] },
  { key: 'stock',      label: 'Stock #',       required: false, candidates: ['stock #', 'stock#', 'stock number', 'stock_number', 'stock', 'stock no'] },
  { key: 'vehicle',    label: 'Vehicle',       required: false, candidates: ['vehicle of interest', 'vehicle_of_interest', 'vehicle', 'sought vehicle'] },
  { key: 'vehicle_year',  label: 'Vehicle year',  required: false, candidates: ['wanted veh year', 'vehicle year', 'vehicle_year', 'year'] },
  { key: 'vehicle_make',  label: 'Vehicle make',  required: false, candidates: ['wanted veh make', 'vehicle make', 'vehicle_make', 'make'] },
  { key: 'vehicle_model', label: 'Vehicle model', required: false, candidates: ['wanted veh model', 'vehicle model', 'vehicle_model', 'model'] },
  { key: 'vehicle_trim',  label: 'Vehicle trim',  required: false, candidates: ['wanted veh trim', 'vehicle trim', 'vehicle_trim', 'trim'] },
  { key: 'new_used',      label: 'New/Used',      required: false, candidates: ['new/used', 'new used', 'new_used', 'condition'] },
  { key: 'notes',      label: 'Notes',         required: false, candidates: ['notes', 'note', 'comments', 'comment'] },
] as const;

export type CrmFieldKey = (typeof CRM_FIELDS)[number]['key'];
export type CrmMapping = Partial<Record<CrmFieldKey, string>>;

export function guessCrmMapping(headers: string[]): CrmMapping {
  const m: CrmMapping = {};
  for (const f of CRM_FIELDS) {
    const g = guessColumn(headers, [...f.candidates]);
    if (g) m[f.key] = g;
  }
  // "name" word-matches "First Name" -- don't take a first/last column as the full name.
  if (m.full_name && (m.full_name === m.first_name || m.full_name === m.last_name)) delete m.full_name;
  return m;
}

// A dealership's saved mapping (crm_column_mappings), applied to this file:
// each saved column is looked up in the file's headers ignoring case and
// spaces at the ends, and returned as the file spells it. Columns the file
// doesn't have are dropped. Null when the saved provider column is missing
// -- the file isn't in that CRM's format.
export function applySavedCrmMapping(headers: string[], saved: CrmMapping | null | undefined): CrmMapping | null {
  if (!saved?.provider) return null;
  const find = (col: string) => headers.find(h => h.trim().toLowerCase() === col.trim().toLowerCase());
  if (!find(saved.provider)) return null;
  const m: CrmMapping = {};
  for (const [k, col] of Object.entries(saved) as [CrmFieldKey, string | undefined][]) {
    const h = col ? find(col) : undefined;
    if (h) m[k] = h;
  }
  return m;
}

// The mapping to use for a file: the dealership's saved one when the file
// fits it, otherwise the built-in guesses.
export function resolveCrmMapping(headers: string[], saved: CrmMapping | null | undefined): { mapping: CrmMapping; fromSaved: boolean } {
  const applied = applySavedCrmMapping(headers, saved);
  return applied ? { mapping: applied, fromSaved: true } : { mapping: guessCrmMapping(headers), fromSaved: false };
}

// A leads file is a CRM file when it fits the dealership's saved mapping, or
// has a column literally named Lead Provider. Only the explicit name counts
// for the guess -- vendor files often have a generic "Source".
export function isCrmFile(headers: string[], saved?: CrmMapping | null): boolean {
  if (applySavedCrmMapping(headers, saved)) return true;
  return guessColumn(headers, ['lead provider', 'lead_provider', 'leadprovider']) != null;
}

export function crmRowsFromFile(rawRows: Record<string, unknown>[], mapping: CrmMapping): CrmLeadRow[] {
  return rawRows.map((raw, idx) => {
    const get = (k: CrmFieldKey): string | null => {
      const col = mapping[k];
      if (!col) return null;
      const v = raw[col];
      if (v == null) return null;
      const s = (v instanceof Date ? v.toISOString() : String(v)).trim();
      return s === '' ? null : s;
    };
    return {
      rowNumber: idx + 2,
      provider: get('provider'),
      firstName: get('first_name'),
      lastName: get('last_name'),
      fullName: get('full_name'),
      email: get('email'),
      phone: get('phone') ?? get('home_phone') ?? get('work_phone'),
      vin: get('vin'),
      stock: get('stock'),
      vehicle: get('vehicle'),
      vehicleYear: get('vehicle_year'),
      vehicleMake: get('vehicle_make'),
      vehicleModel: get('vehicle_model'),
      vehicleTrim: get('vehicle_trim'),
      vehicleCondition: get('new_used'),
      leadDate: parseLeadDate(get('lead_date')),
      notes: get('notes'),
    };
  });
}

// The existing-lead columns matching and blank-filling need.
export interface ExistingLead {
  id: string;
  vendor_id: string | null;
  lead_date: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  vin: string | null;
  stock_number: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_full_name: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_trim: string | null;
  vehicle_of_interest: string | null;
}

export const EXISTING_LEAD_COLUMNS =
  'id, vendor_id, lead_date, customer_email, customer_phone, normalized_email, normalized_phone, vin, stock_number, ' +
  'customer_first_name, customer_last_name, customer_full_name, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_of_interest';

const normId = (v: string | null | undefined): string | null => {
  const s = (v ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return s.length >= 2 ? s : null;
};

// The lead fields a CRM row would write, normalized once.
function leadFieldsFromRow(row: CrmLeadRow) {
  const fullName = row.fullName ?? ([row.firstName, row.lastName].filter(Boolean).join(' ') || null);
  const split = !row.firstName && !row.lastName ? splitName(fullName) : { first: row.firstName, last: row.lastName };
  const parsed = parseVehicle(row.vehicle);
  // Only a plain 4-digit year counts -- eLead sends ranges such as
  // "2015-2027 and Older" for "any year".
  const year = row.vehicleYear && /^\d{4}$/.test(row.vehicleYear.trim()) ? Number(row.vehicleYear.trim()) : parsed.year;
  const make = row.vehicleMake ?? parsed.make;
  const model = row.vehicleModel ?? parsed.model;
  const vehicleText = row.vehicle ?? ([row.vehicleMake, row.vehicleModel].filter(Boolean).join(' ') || null);
  return {
    customer_first_name: split.first,
    customer_last_name: split.last,
    customer_full_name: fullName,
    customer_email: row.email,
    customer_phone: row.phone,
    normalized_email: normalizeEmail(row.email),
    normalized_phone: normalizePhone(row.phone),
    vin: row.vin,
    stock_number: row.stock,
    vehicle_year: year,
    vehicle_make: make,
    vehicle_model: model,
    vehicle_trim: row.vehicleTrim,
    vehicle_of_interest: vehicleText,
  };
}
type LeadFields = ReturnType<typeof leadFieldsFromRow>;

// Matching view of a lead, existing or about to be inserted.
// vehicle: the wanted vehicle as the CRM file describes it (year text, make,
// model, trim, new/used), for telling apart two rows of the same person. Only
// set for CRM rows -- vendor files write vehicles too differently to compare
// as text, so existing leads are compared by VIN / stock # only.
interface MatchKeys { email: string | null; phone: string | null; vin: string | null; stock: string | null; date: number | null; vehicle: string | null }

function keysOf(
  f: { normalized_email: string | null; normalized_phone: string | null; vin: string | null; stock_number: string | null },
  date: string | null,
  vehicle: string | null = null,
): MatchKeys {
  const t = date ? new Date(date).getTime() : NaN;
  return {
    email: f.normalized_email,
    phone: f.normalized_phone,
    vin: normId(f.vin),
    stock: normId(f.stock_number),
    date: Number.isNaN(t) ? null : t,
    vehicle,
  };
}

export function rowVehicleKey(row: CrmLeadRow): string | null {
  const parts = [row.vehicleYear, row.vehicleMake, row.vehicleModel, row.vehicleTrim, row.vehicleCondition, row.vehicle]
    .map(p => (p ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
  return parts.some(Boolean) ? parts.join('|') : null;
}

// Different wanted vehicle = a separate inquiry, even for the same person.
// VIN, then stock #, then the CRM's vehicle description; when either side
// lacks it, that check can't tell them apart.
function differentVehicle(a: MatchKeys, b: MatchKeys): boolean {
  if (a.vin && b.vin) return a.vin !== b.vin;
  if (a.stock && b.stock) return a.stock !== b.stock;
  if (a.vehicle && b.vehicle) return a.vehicle !== b.vehicle;
  return false;
}

// Same lead? Same wanted vehicle (see differentVehicle), any shared
// email/phone/VIN/stock, dates within the window
// (a missing date on either side doesn't rule a match out), and not
// contradicted by contact details: a shared VIN/stock with a DIFFERENT
// email and phone is two shoppers looking at the same vehicle.
function sameLead(a: MatchKeys, b: MatchKeys): boolean {
  if (a.date != null && b.date != null && Math.abs(a.date - b.date) > CRM_MATCH_WINDOW_DAYS * DAY_MS) return false;
  if (differentVehicle(a, b)) return false;
  const eq = (x: string | null, y: string | null) => x != null && y != null && x === y;
  const differ = (x: string | null, y: string | null) => x != null && y != null && x !== y;
  const contactAgrees = eq(a.email, b.email) || eq(a.phone, b.phone);
  if (contactAgrees) return true;
  const vehicleAgrees = eq(a.vin, b.vin) || eq(a.stock, b.stock);
  if (!vehicleAgrees) return false;
  return !(differ(a.email, b.email) || differ(a.phone, b.phone));
}

// Fields on `target` that are blank and that `source` has a value for.
const FILLABLE: (keyof LeadFields)[] = [
  'customer_email', 'normalized_email', 'customer_phone', 'normalized_phone', 'vin', 'stock_number',
  'customer_first_name', 'customer_last_name', 'customer_full_name',
  'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_trim', 'vehicle_of_interest',
];
function blankFill(target: Partial<Record<keyof LeadFields, unknown>>, source: LeadFields): Partial<LeadFields> {
  const patch: Partial<LeadFields> = {};
  for (const k of FILLABLE) {
    const cur = target[k];
    const val = source[k];
    if ((cur == null || cur === '') && val != null && val !== '') (patch as Record<string, unknown>)[k] = val;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
export type SkipReason = 'skip-rule' | 'no-identifier' | 'duplicate-in-file';

export interface PlannedInsert { row: CrmLeadRow; vendorId: string | null; fields: LeadFields }
export interface PlannedEnrich { row: CrmLeadRow; vendorId: string | null; leadId: string; patch: Partial<LeadFields> }
// mergedIntoRow: for 'duplicate-in-file', the file row it was folded into.
export interface PlannedSkip { row: CrmLeadRow; vendorId: string | null; reason: SkipReason; mergedIntoRow?: number }

export interface CrmPlan {
  inserts: PlannedInsert[];
  enrichments: PlannedEnrich[];
  skips: PlannedSkip[];
  // Lead Provider values with no rule -- imported as Unassigned.
  unmappedProviders: Map<string, number>;
  // Per Lead Provider value, for the preview table.
  byProvider: Map<string, { resolution: ProviderResolution; rows: number; inserts: number; matched: number; skipped: number }>;
}

export function planCrmImport(rows: CrmLeadRow[], existing: ExistingLead[], rules: SourceRule[]): CrmPlan {
  const plan: CrmPlan = { inserts: [], enrichments: [], skips: [], unmappedProviders: new Map(), byProvider: new Map() };

  // Candidates per vendor ('' = Unassigned): existing leads first, then
  // rows planned for insert, so a person listed twice in one file becomes
  // one lead.
  type Candidate =
    | { kind: 'existing'; keys: MatchKeys; lead: ExistingLead; enrich?: PlannedEnrich }
    | { kind: 'pending'; keys: MatchKeys; insert: PlannedInsert };
  const pool = new Map<string, Candidate[]>();
  const poolFor = (vendorId: string | null) => {
    const k = vendorId ?? '';
    if (!pool.has(k)) pool.set(k, []);
    return pool.get(k)!;
  };
  // Only leads dated inside the file's own date range are candidates (also
  // enforced by fetchExistingLeads; repeated here so the plan doesn't depend
  // on how `existing` was loaded).
  const window = existingLeadWindow(rows);
  for (const lead of existing) {
    if (!inWindow(lead.lead_date, window)) continue;
    poolFor(lead.vendor_id).push({ kind: 'existing', keys: keysOf(lead, lead.lead_date), lead });
  }

  for (const row of rows) {
    const providerKey = (row.provider ?? '').trim() || '(blank)';
    const resolution = resolveProvider(row.provider, rules);
    const stat = plan.byProvider.get(providerKey) ?? { resolution, rows: 0, inserts: 0, matched: 0, skipped: 0 };
    stat.rows += 1;
    plan.byProvider.set(providerKey, stat);

    if (resolution.kind === 'skip') {
      plan.skips.push({ row, vendorId: null, reason: 'skip-rule' });
      stat.skipped += 1;
      continue;
    }
    const vendorId = resolution.kind === 'vendor' ? resolution.vendorId : null;

    const fields = leadFieldsFromRow(row);
    const keys = keysOf(fields, row.leadDate, rowVehicleKey(row));
    if (!keys.email && !keys.phone && !keys.vin && !keys.stock && !fields.customer_full_name) {
      plan.skips.push({ row, vendorId, reason: 'no-identifier' });
      stat.skipped += 1;
      continue;
    }
    // Counted only for rows that will actually be imported (as Unassigned).
    if (resolution.kind === 'unmapped') {
      plan.unmappedProviders.set(providerKey, (plan.unmappedProviders.get(providerKey) ?? 0) + 1);
    }

    // Closest-in-time candidate that is the same lead.
    const candidates = poolFor(vendorId).filter(c => sameLead(c.keys, keys));
    const dist = (c: Candidate) => (c.keys.date != null && keys.date != null ? Math.abs(c.keys.date - keys.date) : Number.MAX_SAFE_INTEGER);
    const best = candidates.sort((a, b) => dist(a) - dist(b))[0];

    if (!best) {
      const insert: PlannedInsert = { row, vendorId, fields };
      plan.inserts.push(insert);
      poolFor(vendorId).push({ kind: 'pending', keys, insert });
      stat.inserts += 1;
      continue;
    }

    if (best.kind === 'pending') {
      // Same person twice in this file: merge blanks into the pending insert.
      Object.assign(best.insert.fields, blankFill(best.insert.fields, fields));
      best.keys = keysOf(best.insert.fields, best.insert.row.leadDate ?? row.leadDate, best.keys.vehicle);
      plan.skips.push({ row, vendorId, reason: 'duplicate-in-file', mergedIntoRow: best.insert.row.rowNumber });
      stat.skipped += 1;
      continue;
    }

    // Matches an existing lead. Several CRM rows can hit the same lead; they
    // share one enrichment, with later rows only filling what's still blank.
    if (best.enrich) {
      const merged = { ...best.lead, ...best.enrich.patch };
      Object.assign(best.enrich.patch, blankFill(merged, fields));
    } else {
      best.enrich = { row, vendorId, leadId: best.lead.id, patch: blankFill(best.lead, fields) };
      plan.enrichments.push(best.enrich);
    }
    // The lead now stands for the first matching row's vehicle, so a row
    // for a different vehicle becomes its own lead instead.
    best.keys = keysOf({ ...best.lead, ...best.enrich.patch }, best.lead.lead_date, rowVehicleKey(best.enrich.row));
    stat.matched += 1;
  }

  return plan;
}

// The file's own date range, whole days: existing leads are only compared
// (and updated) when their lead date falls inside it -- a September CRM file
// only touches September leads. Days are UTC calendar days, which is the
// local date for leads parsed at local midnight anywhere in the US (how
// every upload path stores a date-only value). Null when no row has a date.
export function existingLeadWindow(rows: CrmLeadRow[]): { from: string; to: string } | null {
  const times = rows.map(r => (r.leadDate ? new Date(r.leadDate).getTime() : NaN)).filter(t => !Number.isNaN(t));
  if (times.length === 0) return null;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return {
    from: `${day(Math.min(...times))}T00:00:00.000Z`,
    to: `${day(Math.max(...times))}T23:59:59.999Z`,
  };
}

function inWindow(date: string | null, window: { from: string; to: string } | null): boolean {
  if (!window) return true;
  if (!date) return false;
  const t = new Date(date).getTime();
  return t >= new Date(window.from).getTime() && t <= new Date(window.to).getTime();
}

// ---------------------------------------------------------------------------
// Database (works with the browser client or the service-role client)
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// Leads in the org that a plan could match: those dated inside the file's
// date range (all leads if no row has a date). Paged -- PostgREST caps a
// response at 1000 rows.
export async function fetchExistingLeads(db: Db, organizationId: string, rows: CrmLeadRow[]): Promise<ExistingLead[]> {
  const window = existingLeadWindow(rows);
  const out: ExistingLead[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = db.from('leads').select(EXISTING_LEAD_COLUMNS).eq('organization_id', organizationId);
    if (window) q = q.gte('lead_date', window.from).lte('lead_date', window.to);
    const { data, error } = await q.order('id').range(from, from + PAGE - 1);
    if (error) throw new Error('Loading existing leads failed: ' + error.message);
    out.push(...((data ?? []) as ExistingLead[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function fetchSourceRules(db: Db, organizationId: string): Promise<SourceRule[]> {
  const { data, error } = await db
    .from('source_mapping_rules')
    .select('pattern, match_type, priority, is_active, vendor_id')
    .eq('organization_id', organizationId);
  if (error) throw new Error('Loading source rules failed: ' + error.message);
  return (data ?? []) as SourceRule[];
}

// A missing saved mapping (or a failed lookup) just means "use the built-in
// guesses", so this never throws.
export async function fetchSavedCrmMapping(db: Db, organizationId: string): Promise<CrmMapping | null> {
  const { data, error } = await db
    .from('crm_column_mappings')
    .select('mapping')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) {
    console.warn('[crmLeads] saved column mapping lookup failed:', error.message);
    return null;
  }
  return (data?.mapping as CrmMapping | undefined) ?? null;
}

export async function saveCrmMapping(db: Db, organizationId: string, mapping: CrmMapping, userId?: string | null): Promise<string | null> {
  // Drop unmapped fields so the stored object is just field -> header.
  const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => !!v));
  const { error } = await db
    .from('crm_column_mappings')
    .upsert({ organization_id: organizationId, mapping: clean, updated_by: userId ?? null, updated_at: new Date().toISOString() });
  return error ? error.message : null;
}

export interface CrmImportResult {
  inserted: number;
  // Rows whose identical lead was already in the DB (dedup_hash collision).
  alreadyImported: number;
  matched: number;
  // Existing leads that actually got blank fields filled.
  enriched: number;
  errors: string[];
}

export async function executeCrmPlan(
  db: Db,
  organizationId: string,
  plan: CrmPlan,
  opts: { rawUploadId?: string | null } = {},
): Promise<CrmImportResult> {
  const result: CrmImportResult = { inserted: 0, alreadyImported: 0, matched: plan.enrichments.length, enriched: 0, errors: [] };

  // Inserts. dedup_hash (same recipe as receive-leads / the email route)
  // makes re-sending the same CRM file a no-op for rows already inserted.
  const records = await Promise.all(plan.inserts.map(async ({ row, vendorId, fields }) => ({
    organization_id: organizationId,
    vendor_id: vendorId,
    ...fields,
    source_label: row.provider,
    notes: row.notes,
    lead_date: row.leadDate,
    lead_status: 'new',
    lead_origin: 'crm',
    raw_upload_id: opts.rawUploadId ?? null,
    dedup_hash: await buildDedupHash({
      email: fields.normalized_email,
      phone: fields.normalized_phone,
      name: (fields.customer_full_name ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
      // Full CRM vehicle (trim, new/used, year text) so two inquiries from
      // one person that differ only there don't collide on the unique index.
      vehicle: rowVehicleKey(row) ?? [fields.vehicle_year, fields.vehicle_make, fields.vehicle_model].filter(Boolean).join(' '),
      vin: fields.vin,
      stock_number: fields.stock_number,
      lead_date: row.leadDate,
    }),
  })));
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { data, error } = await db
      .from('leads')
      .upsert(chunk, { onConflict: 'organization_id,dedup_hash', ignoreDuplicates: true })
      .select('id');
    if (error) { result.errors.push(`Insert failed (rows ${i + 1}-${i + chunk.length}): ${error.message}`); continue; }
    result.inserted += data?.length ?? 0;
    result.alreadyImported += chunk.length - (data?.length ?? 0);
  }

  // Matches: fill blanks and stamp crm_matched_at. Ten at a time.
  const now = new Date().toISOString();
  for (let i = 0; i < plan.enrichments.length; i += 10) {
    await Promise.all(plan.enrichments.slice(i, i + 10).map(async e => {
      const { error } = await db
        .from('leads')
        .update({ ...e.patch, crm_matched_at: now })
        .eq('id', e.leadId)
        .eq('organization_id', organizationId);
      if (error) result.errors.push(`Update of lead ${e.leadId} failed: ${error.message}`);
      else if (Object.keys(e.patch).length > 0) result.enriched += 1;
    }));
  }

  return result;
}
