import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Upload as UploadIcon, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  guessColumn,
  looksNonHuman,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseLeadDate,
  parseVehicle,
  splitName,
} from '@/lib/normalize';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Vendor { id: string; name: string }

const FIELDS = [
  { key: 'first_name',        label: 'First name',                  candidates: ['first name', 'firstname', 'first', 'fname'] },
  { key: 'last_name',         label: 'Last name',                   candidates: ['last name', 'lastname', 'last', 'lname', 'surname'] },
  { key: 'full_name',         label: 'Full name',                   candidates: ['full name', 'name', 'customer name', 'lead name'] },
  { key: 'email',             label: 'Email',                       candidates: ['email', 'e-mail', 'customer email'] },
  { key: 'phone',             label: 'Phone',                       candidates: ['phone', 'mobile', 'cell', 'tel', 'phone number'] },
  { key: 'vehicle',           label: 'Vehicle of interest',         candidates: ['vehicle', 'voi', 'vehicle of interest', 'desired vehicle'] },
  { key: 'lead_date',         label: 'Lead date',                   candidates: ['lead_date', 'lead date', 'date', 'created', 'timestamp', 'opportunities - lead submitted', 'buyer last activity'] },
  { key: 'source',            label: 'Source label',                candidates: ['source', 'lead source', 'origin'] },
  { key: 'vin',               label: 'VIN',                         candidates: ['vin', 'vehicle vin', 'vin number'] },
  { key: 'year',              label: 'Year',                        candidates: ['year', 'model year', 'vehicle year'] },
  { key: 'make',              label: 'Make',                        candidates: ['make', 'vehicle make'] },
  { key: 'model',             label: 'Model',                       candidates: ['model', 'vehicle model'] },
  { key: 'trim',              label: 'Trim',                        candidates: ['trim', 'vehicle trim'] },
  { key: 'body_style',        label: 'Body style',                  candidates: ['body style', 'body', 'bodystyle', 'body type'] },
  { key: 'dol',               label: 'DOL (Days on lot)',           candidates: ['dol', 'days on lot', 'age', 'days in stock'] },
  { key: 'last_price',        label: 'Last price',                  candidates: ['last price', 'price', 'list price', 'asking price'] },
  { key: 'lotlinx_vdp',       label: 'Lotlinx VDP',                candidates: ['lotlinx vdp', 'lotlinx', 'll vdp'] },
  { key: 'total_vdp',         label: 'Total VDP',                   candidates: ['total vdp', 'vdp', 'vdp total', 'vdps'] },
  { key: 'net_new_shoppers',  label: 'Net new shoppers',            candidates: ['net new shoppers', 'new shoppers', 'nns'] },
  { key: 'pct_sales_opps',    label: '% Sales opps since campaign', candidates: ['percentage sales opportunities', 'sales opportunities', '% sales opps', 'pct sales opps', 'sales opps since campaign'] },
  { key: 'type_of_vehicle',   label: 'Type of vehicle',             candidates: ['type of vehicle', 'vehicle type', 'veh type'] },
  { key: 'type_of_leads',     label: 'Type of leads',               candidates: ['type of leads', 'lead type', 'leads type'] },
  { key: 'stock_number',      label: 'Stock number',                candidates: ['stock number', 'stock#', 'stock no', 'stk', 'stk#', 'stk no'] },
  { key: 'notes',             label: 'Notes',                       candidates: ['notes', 'note', 'comments', 'comment', 'remarks', 'memo', 'description'] },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];
const NONE = '__none__';

const JSON_COL_DATE    = 'JSON: Lead Date';
const JSON_COL_VEHICLE = 'JSON: Vehicle Title';
const JSON_COL_STOCK   = 'JSON: Stock Number';

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------
function normVin(raw: string): string | null {
  const v = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return v.length >= 5 ? v : null;
}
function normStock(raw: string): string | null {
  const v = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return v.length >= 2 ? v : null;
}
function normDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Multi-key dedup fingerprints
//
// STEP 1 — if VIN or Stock# is present:
//   email+VIN, phone+VIN, email+Stock#, phone+Stock#
//
// STEP 2 — only if BOTH VIN and Stock# are empty (phone leads):
//   email+lead_date, phone+lead_date,
//   name+phone+lead_date, name+email+lead_date
// ---------------------------------------------------------------------------
function buildLeadFingerprints(opts: {
  email: string; phone: string; vin: string;
  stock: string; name: string; leadDate: string;
}): string[] {
  const keys: string[] = [];
  const { email, phone, name, leadDate } = opts;
  const vin   = normVin(opts.vin)   ?? '';
  const stock = normStock(opts.stock) ?? '';
  const hasVehicle = vin || stock;

  if (hasVehicle) {
    if (email && vin)   keys.push(`email+vin|${email}|${vin}`);
    if (phone && vin)   keys.push(`phone+vin|${phone}|${vin}`);
    if (email && stock) keys.push(`email+stock|${email}|${stock}`);
    if (phone && stock) keys.push(`phone+stock|${phone}|${stock}`);
  } else {
    if (email && leadDate)         keys.push(`email+date|${email}|${leadDate}`);
    if (phone && leadDate)         keys.push(`phone+date|${phone}|${leadDate}`);
    if (name && phone && leadDate) keys.push(`name+phone+date|${name}|${phone}|${leadDate}`);
    if (name && email && leadDate) keys.push(`name+email+date|${name}|${email}|${leadDate}`);
  }
  return keys;
}

function labelFingerprint(key: string): string {
  if (key.startsWith('email+vin|'))       return 'Email + VIN';
  if (key.startsWith('phone+vin|'))       return 'Phone + VIN';
  if (key.startsWith('email+stock|'))     return 'Email + Stock#';
  if (key.startsWith('phone+stock|'))     return 'Phone + Stock#';
  if (key.startsWith('email+date|'))      return 'Email + Lead Date';
  if (key.startsWith('phone+date|'))      return 'Phone + Lead Date';
  if (key.startsWith('name+phone+date|')) return 'Name + Phone + Date';
  if (key.startsWith('name+email+date|')) return 'Name + Email + Date';
  return key;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------
function looksLikeUtf8(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let seqLen: number;
    if (b <= 0x7f)                    { seqLen = 1; }
    else if (b >= 0xc2 && b <= 0xdf) { seqLen = 2; }
    else if (b >= 0xe0 && b <= 0xef) { seqLen = 3; }
    else if (b >= 0xf0 && b <= 0xf4) { seqLen = 4; }
    else                              { return false; }
    for (let j = 1; j < seqLen; j++) {
      if (i + j >= bytes.length) break;
      if ((bytes[i + j] & 0xc0) !== 0x80) return false;
    }
    i += seqLen;
  }
  return true;
}

function readFileWithEncodingDetection(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      try {
        const encoding = looksLikeUtf8(buffer) ? 'utf-8' : 'windows-1252';
        resolve(new TextDecoder(encoding).decode(buffer));
      } catch {
        resolve(new TextDecoder('utf-8').decode(buffer));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ---------------------------------------------------------------------------
// JSON column parser
// ---------------------------------------------------------------------------
interface JsonVehicleEntry {
  stock_number: string | null;
  vehicle_title: string | null;
  prospected_date: string | null;
}

function parseJsonColumn(raw: string): JsonVehicleEntry[] {
  if (!raw || !raw.trim()) return [];
  const cleaned = raw
    .replace(/^\uFEFF/, '').replace(/^"+|"+$/g, '').replace(/\r/g, '')
    .replace(/""/g, '"').replace(/\\"/g, '"').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const dateMatches  = [...cleaned.matchAll(/"Date"\s*:\s*"([^"]*)"/g)];
    const titleMatches = [...cleaned.matchAll(/"Vehicle Title"\s*:\s*"([^"]*)"/g)];
    const stockMatches = [...cleaned.matchAll(/"Stock Number"\s*:\s*"([^"]*)"/g)];
    const count = Math.max(dateMatches.length, stockMatches.length);
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => ({
      prospected_date: dateMatches[i]?.[1]?.trim() || null,
      vehicle_title:   titleMatches[i]?.[1]?.trim() || null,
      stock_number:    stockMatches[i]?.[1]?.trim() || null,
    }));
  }
  const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
  return arr.filter(e => e && typeof e === 'object').map(e => ({
    stock_number:    (e['Stock Number'] ?? '').toString().trim() || null,
    vehicle_title:   (e['Vehicle Title'] ?? '').toString().trim() || null,
    prospected_date: (e['Date'] ?? '').toString().trim() || null,
  }));
}

function explodeRow(row: Record<string, string>, jsonColumnName: string): Record<string, string>[] {
  const raw = (row[jsonColumnName] ?? '').trim();
  const entries = parseJsonColumn(raw);
  if (entries.length === 0) return [{ ...row, [JSON_COL_DATE]: '', [JSON_COL_VEHICLE]: '', [JSON_COL_STOCK]: '' }];
  return entries.map(e => ({ ...row, [JSON_COL_DATE]: e.prospected_date ?? '', [JSON_COL_VEHICLE]: e.vehicle_title ?? '', [JSON_COL_STOCK]: e.stock_number ?? '' }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DetectedDupe {
  rowIndex: number;
  name: string; email: string; phone: string;
  vin: string; stock: string; leadDate: string;
  reason: 'Duplicate within file' | 'Already in database';
  matchedOn: string;
  payload: any;
  reinstated: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function UploadPage() {
  const { user } = useAuth();
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string>(NONE);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({} as any);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; duplicates: number } | null>(null);
  const [hasJsonColumn, setHasJsonColumn] = useState(false);
  const [jsonColumnName, setJsonColumnName] = useState<string>(NONE);

  // Dedup review modal
  const [reviewOpen, setReviewOpen]       = useState(false);
  const [detectedDupes, setDetectedDupes] = useState<DetectedDupe[]>([]);
  const [cleanRows, setCleanRows]         = useState<any[]>([]);
  const [uploadId, setUploadId]           = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrgId) return;
    supabase.from('vendors').select('id, name').eq('organization_id', activeOrgId).order('name')
      .then(({ data }) => setVendors((data ?? []) as Vendor[]));
  }, [activeOrgId]);

  const effectiveRows = useMemo(() => {
    if (!hasJsonColumn || jsonColumnName === NONE || rows.length === 0) return rows;
    return rows.flatMap(row => explodeRow(row, jsonColumnName));
  }, [rows, hasJsonColumn, jsonColumnName]);

  const effectiveHeaders = useMemo(() => {
    if (!hasJsonColumn || jsonColumnName === NONE) return headers;
    const syntheticCols = [JSON_COL_DATE, JSON_COL_VEHICLE, JSON_COL_STOCK];
    const existing = new Set(headers);
    return [...headers, ...syntheticCols.filter(c => !existing.has(c))];
  }, [headers, hasJsonColumn, jsonColumnName]);

  useEffect(() => {
    if (!hasJsonColumn || jsonColumnName === NONE) return;
    setMapping(prev => ({ ...prev, lead_date: JSON_COL_DATE, vehicle: JSON_COL_VEHICLE, stock_number: JSON_COL_STOCK }));
  }, [hasJsonColumn, jsonColumnName]);

  const onFile = async (f: File | null) => {
    if (f) {
      const allowed = ['.csv', '.tsv', '.txt'];
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (!allowed.includes(ext)) {
        toast.error(`Unsupported file type: ${f.name}`, { description: 'Please upload a CSV file. Excel files (.xlsx/.xls) are not supported — export as CSV first.' });
        return;
      }
    }
    setFile(f); setRows([]); setHeaders([]); setResult(null);
    setHasJsonColumn(false); setJsonColumnName(NONE);
    setDetectedDupes([]); setCleanRows([]); setUploadId(null);
    if (!f) return;
    let csvText: string;
    try { csvText = await readFileWithEncodingDetection(f); }
    catch (err: any) { toast.error(`Could not read file: ${err.message}`); return; }
    Papa.parse<Record<string, string>>(csvText, {
      header: true, skipEmptyLines: true, delimiter: '',
      complete: (res) => {
        const hdrs = (res.meta.fields ?? []).filter(h => h.trim() !== '');
        const data = res.data as Record<string, string>[];
        setHeaders(hdrs); setRows(data);
        const m: Partial<Record<FieldKey, string>> = {};
        for (const field of FIELDS) { const guess = guessColumn(hdrs, [...field.candidates]); if (guess) m[field.key] = guess; }
        setMapping(m as Record<FieldKey, string>);
        toast.success(`Parsed ${data.length} rows`);
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  };

  const preview = useMemo(() => effectiveRows.slice(0, 5), [effectiveRows]);

  const normalizedPreview = useMemo(() => {
    if (preview.length === 0) return [] as Record<string, any>[];
    const get = (row: Record<string, string>, key: FieldKey) => { const col = mapping[key]; if (!col || col === NONE) return ''; return (row[col] ?? '').toString().trim(); };
    const toNum = (s: string): number | null => { if (!s) return null; const n = parseFloat(s.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
    const toInt = (s: string): number | null => { const n = toNum(s); return n === null ? null : Math.round(n); };
    return preview.map((row) => {
      const fullName = get(row, 'full_name') || [get(row, 'first_name'), get(row, 'last_name')].filter(Boolean).join(' ');
      const email = get(row, 'email'); const phone = get(row, 'phone'); const veh = get(row, 'vehicle') || ''; const vin = get(row, 'vin');
      const parsed = parseVehicle(veh);
      const firstMapped = mapping['first_name'] && mapping['first_name'] !== NONE;
      const lastMapped = mapping['last_name'] && mapping['last_name'] !== NONE;
      const { first, last } = (!firstMapped && !lastMapped) ? splitName(fullName) : { first: '', last: '' };
      const yearRaw = get(row, 'year'); const yearNum = yearRaw ? parseInt(yearRaw, 10) : NaN;
      return {
        customer_first_name: firstMapped ? (get(row, 'first_name') || null) : (first || null),
        customer_last_name: lastMapped ? (get(row, 'last_name') || null) : (last || null),
        customer_full_name: fullName || null, customer_email: email || null, customer_phone: phone || null,
        normalized_email: normalizeEmail(email) || null, normalized_phone: normalizePhone(phone) || null,
        vin: vin || null, vehicle_year: !isNaN(yearNum) ? yearNum : parsed.year,
        vehicle_make: get(row, 'make') || parsed.make || null, vehicle_model: get(row, 'model') || parsed.model || null,
        vehicle_of_interest: veh || [get(row, 'year'), get(row, 'make') || parsed.make, get(row, 'model') || parsed.model].filter(Boolean).join(' ') || null,
        vehicle_trim: get(row, 'trim') || null, body_style: get(row, 'body_style') || null,
        dol: toInt(get(row, 'dol')), last_price: toNum(get(row, 'last_price')),
        lotlinx_vdp: toInt(get(row, 'lotlinx_vdp')), total_vdp: toInt(get(row, 'total_vdp')),
        net_new_shoppers: toInt(get(row, 'net_new_shoppers')), pct_sales_opps_since_campaign: toNum(get(row, 'pct_sales_opps')),
        lead_date: parseLeadDate(get(row, 'lead_date')) ?? '(today — no value found)',
        source_label: get(row, 'source') || null, type_of_vehicle: get(row, 'type_of_vehicle') || null,
        type_of_leads: get(row, 'type_of_leads') || null, stock_number: get(row, 'stock_number') || null,
        notes: get(row, 'notes') || null, lead_status: 'new',
      };
    });
  }, [preview, mapping]);

  const nameWarnings = useMemo(() => {
    if (effectiveRows.length === 0) return [] as { field: string; column: string; samples: string[]; count: number }[];
    const fieldsToCheck: { key: FieldKey; label: string }[] = [
      { key: 'first_name', label: 'First name' }, { key: 'last_name', label: 'Last name' }, { key: 'full_name', label: 'Full name' },
    ];
    const sample = effectiveRows.slice(0, 50);
    const out: { field: string; column: string; samples: string[]; count: number }[] = [];
    for (const f of fieldsToCheck) {
      const col = mapping[f.key]; if (!col || col === NONE) continue;
      const bad: string[] = [];
      for (const r of sample) { const v = (r[col] ?? '').toString().trim(); if (looksNonHuman(v)) bad.push(v); }
      if (bad.length > 0) out.push({ field: f.label, column: col, samples: Array.from(new Set(bad)).slice(0, 3), count: bad.length });
    }
    return out;
  }, [effectiveRows, mapping]);

  // ---------------------------------------------------------------------------
  // Step 1: Parse, normalize, dedup check, open review modal
  // ---------------------------------------------------------------------------
  const prepareImport = async () => {
    if (!activeOrgId || !user || !file) return;
    if (effectiveRows.length === 0) return toast.error('No rows to import');
    setBusy(true);
    try {
      const { data: upload, error: upErr } = await supabase
        .from('raw_lead_uploads')
        .insert({
          organization_id: activeOrgId,
          vendor_id: vendorId === NONE ? null : vendorId,
          uploaded_by: user.id,
          filename: file.name,
          row_count: effectiveRows.length,
          column_mapping: mapping,
          raw_rows: rows.slice(0, 1000),
        })
        .select('id').single();
      if (upErr || !upload) throw upErr ?? new Error('Upload create failed');
      setUploadId(upload.id);

      const get = (row: Record<string, string>, key: FieldKey) => { const col = mapping[key]; if (!col || col === NONE) return ''; return (row[col] ?? '').toString().trim(); };
      const toNum = (s: string): number | null => { if (!s) return null; const n = parseFloat(s.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
      const toInt = (s: string): number | null => { const n = toNum(s); return n === null ? null : Math.round(n); };

      const seenInFile = new Set<string>();
      const readyToInsert: any[] = [];
      const dupes: DetectedDupe[] = [];

      for (let rowIdx = 0; rowIdx < effectiveRows.length; rowIdx++) {
        const row = effectiveRows[rowIdx];
        const fullName    = get(row, 'full_name') || [get(row, 'first_name'), get(row, 'last_name')].filter(Boolean).join(' ');
        const email       = get(row, 'email');
        const phone       = get(row, 'phone');
        const veh         = get(row, 'vehicle') || '';
        const vin         = get(row, 'vin');
        const stockRaw    = get(row, 'stock_number') || '';
        const leadDateRaw = get(row, 'lead_date');
        if (!fullName && !email && !phone && !veh && !vin) continue;

        const normEmail   = normalizeEmail(email) ?? '';
        const normPhone   = normalizePhone(phone) ?? '';
        const normNameStr = normalizeName(fullName);
        const nVin        = normVin(vin) ?? '';
        const nStock      = normStock(stockRaw) ?? '';
        const leadDateIso = parseLeadDate(leadDateRaw) ?? new Date().toISOString();
        const leadDateStr = normDate(leadDateIso);

        const fingerprints = buildLeadFingerprints({ email: normEmail, phone: normPhone, vin: nVin, stock: nStock, name: normNameStr, leadDate: leadDateStr });
        const inFileHit = fingerprints.find(fp => seenInFile.has(fp));

        const parsed = parseVehicle(veh);
        const firstMapped = mapping['first_name'] && mapping['first_name'] !== NONE;
        const lastMapped  = mapping['last_name']  && mapping['last_name']  !== NONE;
        const { first, last } = (!firstMapped && !lastMapped) ? splitName(fullName) : { first: '', last: '' };
        const yearRaw = get(row, 'year'); const yearNum = yearRaw ? parseInt(yearRaw, 10) : NaN;
        const explicitYear = !isNaN(yearNum) ? yearNum : null;
        const explicitMake = get(row, 'make') || null; const explicitModel = get(row, 'model') || null;

        const payload = {
          organization_id:               activeOrgId,
          vendor_id:                     vendorId === NONE ? null : vendorId,
          raw_upload_id:                 upload.id,
          customer_first_name:           firstMapped ? (get(row, 'first_name') || null) : (first || null),
          customer_last_name:            lastMapped  ? (get(row, 'last_name')  || null) : (last  || null),
          customer_full_name:            fullName || null,
          customer_email:                email    || null,
          customer_phone:                phone    || null,
          normalized_email:              normEmail  || null,
          normalized_phone:              normPhone  || null,
          vehicle_of_interest:           veh || [explicitYear, explicitMake ?? parsed.make, explicitModel ?? parsed.model].filter(Boolean).join(' ') || null,
          vehicle_year:                  explicitYear ?? parsed.year,
          vehicle_make:                  (explicitMake ?? parsed.make) || null,
          vehicle_model:                 (explicitModel ?? parsed.model) || null,
          vin:                           nVin   || null,
          vehicle_trim:                  get(row, 'trim') || null,
          body_style:                    get(row, 'body_style') || null,
          dol:                           toInt(get(row, 'dol')),
          last_price:                    toNum(get(row, 'last_price')),
          lotlinx_vdp:                   toInt(get(row, 'lotlinx_vdp')),
          total_vdp:                     toInt(get(row, 'total_vdp')),
          net_new_shoppers:              toInt(get(row, 'net_new_shoppers')),
          pct_sales_opps_since_campaign: toNum(get(row, 'pct_sales_opps')),
          lead_date:                     leadDateIso,
          source_label:                  get(row, 'source')           || null,
          type_of_vehicle:               get(row, 'type_of_vehicle')  || null,
          type_of_leads:                 get(row, 'type_of_leads')    || null,
          stock_number:                  nStock || null,
          notes:                         get(row, 'notes') || null,
          lead_status:                   'new',
          // Internal metadata — stripped before insert
          __fingerprints: fingerprints,
          __normEmail: normEmail,
          __normPhone: normPhone,
          __nVin: nVin,
          __nStock: nStock,
        };

        if (inFileHit) {
          dupes.push({ rowIndex: rowIdx, name: fullName, email, phone, vin: nVin, stock: nStock, leadDate: leadDateStr, reason: 'Duplicate within file', matchedOn: labelFingerprint(inFileHit), payload, reinstated: false });
          continue;
        }
        fingerprints.forEach(fp => seenInFile.add(fp));
        readyToInsert.push(payload);
      }

      // Query DB for existing leads — only fields needed to rebuild fingerprints
      const { data: existingLeads, error: existingErr } = await supabase
        .from('leads')
        .select('normalized_email, normalized_phone, vin, stock_number, customer_full_name, lead_date')
        .eq('organization_id', activeOrgId)
        .limit(10000);
      if (existingErr) throw new Error(`Dedup DB check failed: ${existingErr.message}`);

      const dbFingerprints = new Set<string>();
      for (const dbRow of existingLeads ?? []) {
        buildLeadFingerprints({
          email:    dbRow.normalized_email ?? '',
          phone:    dbRow.normalized_phone ?? '',
          vin:      dbRow.vin ?? '',
          stock:    dbRow.stock_number ?? '',
          name:     normalizeName(dbRow.customer_full_name ?? ''),
          leadDate: normDate(dbRow.lead_date),
        }).forEach(fp => dbFingerprints.add(fp));
      }

      const finalClean: any[] = [];
      for (const r of readyToInsert) {
        const dbHit = (r.__fingerprints as string[]).find(fp => dbFingerprints.has(fp));
        if (dbHit) {
          dupes.push({ rowIndex: -1, name: r.customer_full_name ?? '', email: r.customer_email ?? '', phone: r.customer_phone ?? '', vin: r.__nVin, stock: r.__nStock, leadDate: '', reason: 'Already in database', matchedOn: labelFingerprint(dbHit), payload: r, reinstated: false });
        } else {
          finalClean.push(r);
        }
      }

      const stripMeta = (r: any) => { const { __fingerprints, __normEmail, __normPhone, __nVin, __nStock, ...rest } = r; return rest; };
      setCleanRows(finalClean.map(stripMeta));
      setDetectedDupes(dupes);

      if (dupes.length > 0) {
        setReviewOpen(true);
      } else {
        await doInsert(finalClean.map(stripMeta), [], upload.id);
      }

    } catch (e: any) {
      toast.error(e.message ?? 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step 2: User confirmed — insert clean + reinstated rows
  // ---------------------------------------------------------------------------
  const doInsert = async (clean: any[], reinstated: any[], upId: string) => {
    const toInsert = [...clean, ...reinstated];
    if (toInsert.length === 0) {
      setResult({ inserted: 0, duplicates: detectedDupes.length });
      toast.warning('No rows to insert after review.');
      setReviewOpen(false);
      return;
    }
    setBusy(true);
    try {
      const CHUNK = 200;
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK);
        const { error: insErr } = await supabase.from('leads').insert(slice);
        if (insErr) throw insErr;
        inserted += slice.length;
      }
      const skipped = detectedDupes.filter(d => !d.reinstated).length;
      await supabase.from('raw_lead_uploads').update({ inserted_count: inserted, duplicate_count: skipped }).eq('id', upId);
      setResult({ inserted, duplicates: skipped });
      toast.success(`Imported ${inserted} leads · ${skipped} duplicates skipped`);
      setReviewOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? 'Insert failed');
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!uploadId) return;
    const stripMeta = (r: any) => { const { __fingerprints, __normEmail, __normPhone, __nVin, __nStock, ...rest } = r; return rest; };
    const reinstated = detectedDupes.filter(d => d.reinstated).map(d => stripMeta(d.payload));
    await doInsert(cleanRows, reinstated, uploadId);
  };

  const toggleReinstate = (idx: number) => {
    setDetectedDupes(prev => prev.map((d, i) => i === idx ? { ...d, reinstated: !d.reinstated } : d));
  };

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload Leads (CSV)</h1>
        <p className="text-sm text-muted-foreground">
          For {activeOrg?.name}. Map your columns — duplicates are detected before import so you can review them.
        </p>
      </div>

      {/* Step 1 */}
      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose file & vendor</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>CSV file</Label>
            <Input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" onChange={e => onFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="grid gap-2">
            <Label>Vendor (lead source)</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Choose vendor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Unassigned —</SelectItem>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: JSON column */}
      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. JSON column (optional)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Some vendors store multiple vehicle entries as a JSON array inside one column.
              Enable this if your file has such a column — each JSON entry becomes its own lead record.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center gap-3">
              <input
                id="has-json-col" type="checkbox" className="h-4 w-4 cursor-pointer"
                checked={hasJsonColumn}
                onChange={e => {
                  setHasJsonColumn(e.target.checked);
                  if (!e.target.checked) {
                    setJsonColumnName(NONE);
                    setMapping(prev => {
                      const next = { ...prev };
                      if (next['lead_date']    === JSON_COL_DATE)    delete next['lead_date'];
                      if (next['vehicle']      === JSON_COL_VEHICLE) delete next['vehicle'];
                      if (next['stock_number'] === JSON_COL_STOCK)   delete next['stock_number'];
                      return next;
                    });
                  }
                }}
              />
              <Label htmlFor="has-json-col" className="cursor-pointer">This file contains a JSON column</Label>
            </div>
            {hasJsonColumn && (
              <div className="grid gap-2 max-w-sm">
                <Label className="text-xs">Which column contains the JSON?</Label>
                <Select value={jsonColumnName} onValueChange={setJsonColumnName}>
                  <SelectTrigger><SelectValue placeholder="Select column…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Select column —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
                {jsonColumnName !== NONE && (
                  <p className="text-xs text-muted-foreground">
                    ✓ Rows will be exploded — each JSON entry becomes a separate lead.
                    <strong> {effectiveRows.length} total lead rows</strong> (from {rows.length} CSV rows).
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {effectiveHeaders.length > 0 && (
        <>
          {/* Step 3: Map columns */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" /> 3. Map columns
                <Badge variant="secondary" className="ml-2">{effectiveRows.length} rows</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {FIELDS.map(f => (
                <div key={f.key} className="grid gap-1">
                  <Label className="text-xs">{f.label}</Label>
                  <Select value={mapping[f.key] || NONE} onValueChange={v => setMapping(prev => ({ ...prev, [f.key]: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Skip —</SelectItem>
                      {effectiveHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Step 4: Raw preview */}
          <Card>
            <CardHeader><CardTitle className="text-base">4. Raw preview (first 5 rows)</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b">{effectiveHeaders.map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody>{preview.map((r, i) => (<tr key={i} className="border-b">{effectiveHeaders.map(h => <td key={h} className="px-2 py-1 text-muted-foreground">{r[h]}</td>)}</tr>))}</tbody>
              </table>
            </CardContent>
          </Card>

          {/* Step 5: Mapped preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">5. Mapped preview — how it will be imported</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Only mapped fields are shown. Yellow/red cells flag suspicious values.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {(() => {
                const mappedFields = FIELDS.filter(f => mapping[f.key] && mapping[f.key] !== NONE);
                if (mappedFields.length === 0) return <p className="text-xs text-muted-foreground">No fields mapped yet.</p>;
                const nameKeys = new Set(['first_name', 'last_name', 'full_name']);
                return (
                  <table className="w-full text-xs">
                    <thead><tr className="border-b">{mappedFields.map(f => (<th key={f.key} className="px-2 py-1 text-left font-medium whitespace-nowrap"><div className="text-foreground">{f.label}</div><div className="text-[10px] font-normal text-muted-foreground">← {mapping[f.key]}</div></th>))}</tr></thead>
                    <tbody>{preview.map((r, i) => (<tr key={i} className="border-b">{mappedFields.map(f => { const v = (r[mapping[f.key]] ?? '').toString().trim(); const flag = nameKeys.has(f.key) && looksNonHuman(v); return (<td key={f.key} className={`px-2 py-1 whitespace-nowrap ${flag ? 'bg-destructive/10 text-destructive font-medium' : 'text-muted-foreground'}`} title={flag ? 'Looks like a price/number — not a name' : undefined}>{v || <span className="text-muted-foreground/50">—</span>}</td>); })}</tr>))}</tbody>
                  </table>
                );
              })()}
            </CardContent>
          </Card>

          {/* Step 6: Normalized preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">6. Final preview — first 5 records exactly as they will be saved</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Includes normalization: split first/last name, parsed year/make/model, parsed dates, normalized phone/email.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {normalizedPreview.length === 0 ? (
                <p className="text-xs text-muted-foreground">Map at least one column to see the preview.</p>
              ) : (
                <div className="max-h-[420px] overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Field</th>
                        {normalizedPreview.map((_, i) => <th key={i} className="px-2 py-1 text-left font-medium whitespace-nowrap">Row {i + 1}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(normalizedPreview[0]).map(field => (
                        <tr key={field} className="border-b">
                          <td className="px-2 py-1 font-medium whitespace-nowrap text-foreground">{field}</td>
                          {normalizedPreview.map((row, i) => {
                            const v = (row as any)[field];
                            const display = v === null || v === undefined || v === '' ? <span className="text-muted-foreground/50 italic">null</span> : String(v);
                            return <td key={i} className="px-2 py-1 align-top whitespace-nowrap text-muted-foreground">{display}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {nameWarnings.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Name column may be misclassified</AlertTitle>
              <AlertDescription>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
                  {nameWarnings.map(w => (
                    <li key={w.field}>
                      <strong>{w.field}</strong> is mapped to column <code className="px-1 rounded bg-muted">{w.column}</code> —
                      found {w.count} value(s) with $ or pure numbers (e.g. {w.samples.map(s => `"${s}"`).join(', ')}).
                      This usually means the column contains a price or count, not a person's name. Re-map or set to "Skip".
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Import button */}
          <div className="flex items-center justify-between gap-3">
            {result && (
              <div className="flex items-center gap-3">
                <div className="text-sm">
                  <Badge className="mr-2">{result.inserted} inserted</Badge>
                  <Badge variant="secondary">{result.duplicates} duplicates skipped</Badge>
                </div>
                {result.inserted > 0 && <Button variant="outline" asChild><Link to="/leads">View Leads →</Link></Button>}
              </div>
            )}
            <Button
              onClick={prepareImport}
              disabled={busy || nameWarnings.length > 0 || vendorId === NONE || (hasJsonColumn && jsonColumnName === NONE)}
              className="ml-auto"
              title={vendorId === NONE ? 'Select a vendor before importing' : hasJsonColumn && jsonColumnName === NONE ? 'Select which column contains the JSON' : nameWarnings.length > 0 ? 'Fix name column mapping above to enable import' : undefined}
            >
              <UploadIcon className="mr-1 h-4 w-4" />
              {busy ? 'Checking...' : vendorId === NONE ? 'Select a vendor to import' : hasJsonColumn && jsonColumnName === NONE ? 'Select JSON column to import' : nameWarnings.length > 0 ? 'Fix mapping to import' : `Import ${effectiveRows.length} rows`}
            </Button>
          </div>
        </>
      )}

      {/* ── Dedup Review Modal ─────────────────────────────────────────────── */}
      <Dialog open={reviewOpen} onOpenChange={o => { if (!busy) setReviewOpen(o); }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Review Duplicates Before Import</DialogTitle>
            <DialogDescription>
              {detectedDupes.length} duplicate{detectedDupes.length !== 1 ? 's' : ''} detected.
              Check the box next to any row you want to import anyway, then click Confirm & Import.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-3 text-sm mb-2">
            <span className="rounded-md border bg-muted px-3 py-1.5 font-medium">
              ✅ {cleanRows.length} clean rows ready
            </span>
            <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 font-medium text-amber-800">
              ⚠️ {detectedDupes.filter(d => !d.reinstated).length} will be skipped
            </span>
            <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 font-medium text-blue-800">
              🔄 {detectedDupes.filter(d => d.reinstated).length} reinstated by you
            </span>
          </div>

          <div className="max-h-[50vh] overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-2 text-left">Import?</th>
                  <th className="px-2 py-2 text-left">Name</th>
                  <th className="px-2 py-2 text-left">Email</th>
                  <th className="px-2 py-2 text-left">Phone</th>
                  <th className="px-2 py-2 text-left">VIN</th>
                  <th className="px-2 py-2 text-left">Stock #</th>
                  <th className="px-2 py-2 text-left">Lead Date</th>
                  <th className="px-2 py-2 text-left">Reason</th>
                  <th className="px-2 py-2 text-left">Matched on</th>
                </tr>
              </thead>
              <tbody>
                {detectedDupes.map((d, i) => (
                  <tr key={i} className={`border-t ${d.reinstated ? 'bg-blue-50' : ''}`}>
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={d.reinstated} onChange={() => toggleReinstate(i)} className="h-4 w-4 cursor-pointer" title="Check to import this row anyway" />
                    </td>
                    <td className="px-2 py-2 font-medium">{d.name || '—'}</td>
                    <td className="px-2 py-2 text-muted-foreground">{d.email || '—'}</td>
                    <td className="px-2 py-2 text-muted-foreground">{d.phone || '—'}</td>
                    <td className="px-2 py-2 font-mono text-muted-foreground">{d.vin || '—'}</td>
                    <td className="px-2 py-2 text-muted-foreground">{d.stock || '—'}</td>
                    <td className="px-2 py-2 text-muted-foreground">{d.leadDate || '—'}</td>
                    <td className="px-2 py-2 text-amber-700">{d.reason}</td>
                    <td className="px-2 py-2 text-muted-foreground">{d.matchedOn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={confirmImport} disabled={busy}>
              {busy ? 'Importing...' : `Confirm & Import ${cleanRows.length + detectedDupes.filter(d => d.reinstated).length} rows`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
