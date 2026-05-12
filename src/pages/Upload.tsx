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
import { Upload as UploadIcon, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import {
  buildDedupHash,
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
import { AlertTriangle } from 'lucide-react';

interface Vendor { id: string; name: string }

const FIELDS = [
  { key: 'first_name', label: 'First name', candidates: ['first name', 'firstname', 'first', 'fname'] },
  { key: 'last_name', label: 'Last name', candidates: ['last name', 'lastname', 'last', 'lname', 'surname'] },
  { key: 'full_name', label: 'Full name', candidates: ['full name', 'name', 'customer name', 'lead name'] },
  { key: 'email', label: 'Email', candidates: ['email', 'e-mail', 'customer email'] },
  { key: 'phone', label: 'Phone', candidates: ['phone', 'mobile', 'cell', 'tel', 'phone number'] },
  { key: 'vehicle', label: 'Vehicle of interest', candidates: ['vehicle', 'voi', 'vehicle of interest', 'desired vehicle'] },
  { key: 'lead_date', label: 'Lead date', candidates: ['lead_date', 'lead date', 'date', 'created', 'timestamp', 'opportunities - lead submitted', 'buyer last activity'] },
  { key: 'source', label: 'Source label', candidates: ['source', 'lead source', 'origin'] },
  { key: 'vin', label: 'VIN', candidates: ['vin', 'vehicle vin', 'vin number'] },
  { key: 'year', label: 'Year', candidates: ['year', 'model year', 'vehicle year'] },
  { key: 'make', label: 'Make', candidates: ['make', 'vehicle make'] },
  { key: 'model', label: 'Model', candidates: ['model', 'vehicle model'] },
  { key: 'trim', label: 'Trim', candidates: ['trim', 'vehicle trim'] },
  { key: 'body_style', label: 'Body style', candidates: ['body style', 'body', 'bodystyle', 'body type'] },
  { key: 'dol', label: 'DOL (Days on lot)', candidates: ['dol', 'days on lot', 'age', 'days in stock'] },
  { key: 'last_price', label: 'Last price', candidates: ['last price', 'price', 'list price', 'asking price'] },
  { key: 'lotlinx_vdp', label: 'Lotlinx VDP', candidates: ['lotlinx vdp', 'lotlinx', 'll vdp'] },
  { key: 'total_vdp', label: 'Total VDP', candidates: ['total vdp', 'vdp', 'vdp total', 'vdps'] },
  { key: 'net_new_shoppers', label: 'Net new shoppers', candidates: ['net new shoppers', 'new shoppers', 'nns'] },
  { key: 'pct_sales_opps', label: '% Sales opps since campaign', candidates: ['percentage sales opportunities', 'sales opportunities', '% sales opps', 'pct sales opps', 'sales opps since campaign'] },
  { key: 'type_of_vehicle', label: 'Type of vehicle', candidates: ['type of vehicle', 'vehicle type', 'veh type'] },
  { key: 'type_of_leads', label: 'Type of leads', candidates: ['type of leads', 'lead type', 'leads type'] },
  { key: 'stock_number', label: 'Stock number', candidates: ['stock number', 'stock#', 'stock no', 'stk', 'stk#', 'stk no'] },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

const NONE = '__none__';

// ---------------------------------------------------------------------------
// Synthetic column name constants for JSON explode mode
// WHY: We inject virtual columns into the header/row data so the user can
// map them normally in the UI, just like any other column. These names are
// prefixed with "JSON:" so they are clearly labelled and never clash with
// real CSV column names.
// ---------------------------------------------------------------------------
const JSON_COL_DATE    = 'JSON: Lead Date';
const JSON_COL_VEHICLE = 'JSON: Vehicle Title';
const JSON_COL_STOCK   = 'JSON: Stock Number';

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/**
 * Sniff whether a raw byte buffer looks like valid UTF-8.
 * We scan up to the first 4 KB to keep it fast.
 * If we find any byte sequence that's illegal in UTF-8, we assume Windows-1252.
 */
function looksLikeUtf8(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let seqLen: number;
    if (b <= 0x7f) {
      seqLen = 1;
    } else if (b >= 0xc2 && b <= 0xdf) {
      seqLen = 2;
    } else if (b >= 0xe0 && b <= 0xef) {
      seqLen = 3;
    } else if (b >= 0xf0 && b <= 0xf4) {
      seqLen = 4;
    } else {
      return false;
    }
    for (let j = 1; j < seqLen; j++) {
      if (i + j >= bytes.length) break;
      if ((bytes[i + j] & 0xc0) !== 0x80) return false;
    }
    i += seqLen;
  }
  return true;
}

/**
 * Read a File, auto-detect UTF-8 vs Windows-1252, and return the decoded string.
 */
function readFileWithEncodingDetection(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      try {
        const encoding = looksLikeUtf8(buffer) ? 'utf-8' : 'windows-1252';
        const decoder = new TextDecoder(encoding);
        resolve(decoder.decode(buffer));
      } catch (e) {
        const decoder = new TextDecoder('utf-8');
        resolve(decoder.decode(buffer));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ---------------------------------------------------------------------------
// Generic JSON column parser
// WHY: Instead of hardcoding "Opportunities - Prospected Vehicles", we now
// accept any column name the user selects. This makes the feature work for
// any vendor — current or future — that puts JSON arrays in a CSV column.
//
// The JSON array format we expect (but handle loosely):
//   [{ "Date": "5/4/2026", "Vehicle Title": "2022 Ford F-150", "Stock Number": "244238" }, ...]
//
// We return ALL entries in the array, not just the first, so the caller can
// explode one CSV row into multiple lead records.
// ---------------------------------------------------------------------------

interface JsonVehicleEntry {
  stock_number: string | null;
  vehicle_title: string | null;
  prospected_date: string | null;
}

function parseJsonColumn(raw: string): JsonVehicleEntry[] {
  if (!raw || !raw.trim()) return [];

  // Clean up common CSV export artifacts
  const cleaned = raw
    .replace(/^\uFEFF/, '')     // BOM
    .replace(/^"+|"+$/g, '')    // wrapping double-quotes added by some exporters
    .replace(/\r/g, '')         // carriage returns
    .replace(/""/g, '"')        // CSV doubled-quotes "" → "
    .replace(/\\"/g, '"')       // backslash-escaped quotes \" → "
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Fallback: try to extract all Date/Vehicle Title/Stock Number entries via regex
    // WHY: Some exporters produce slightly malformed JSON. We still want to get data out.
    const dateMatches    = [...cleaned.matchAll(/"Date"\s*:\s*"([^"]*)"/g)];
    const titleMatches   = [...cleaned.matchAll(/"Vehicle Title"\s*:\s*"([^"]*)"/g)];
    const stockMatches   = [...cleaned.matchAll(/"Stock Number"\s*:\s*"([^"]*)"/g)];
    const count = Math.max(dateMatches.length, stockMatches.length);
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => ({
      prospected_date: dateMatches[i]?.[1]?.trim() || null,
      vehicle_title:   titleMatches[i]?.[1]?.trim() || null,
      stock_number:    stockMatches[i]?.[1]?.trim() || null,
    }));
  }

  // Normalize to array regardless of whether the JSON was an object or array
  const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];

  return arr
    .filter(entry => entry && typeof entry === 'object')
    .map(entry => ({
      stock_number:    (entry['Stock Number'] ?? '').toString().trim() || null,
      vehicle_title:   (entry['Vehicle Title'] ?? '').toString().trim() || null,
      prospected_date: (entry['Date'] ?? '').toString().trim() || null,
    }));
}

// ---------------------------------------------------------------------------
// Row exploder
// WHY: When a CSV row contains a JSON column with N entries, we create N
// separate flat rows — one per JSON entry — each carrying the same base
// customer data but a different date/vehicle/stock from the JSON array.
// Rows without JSON data (empty JSON column) are returned as-is (1 row in,
// 1 row out), so normal files are completely unaffected.
// ---------------------------------------------------------------------------

function explodeRow(
  row: Record<string, string>,
  jsonColumnName: string,
): Record<string, string>[] {
  const raw = (row[jsonColumnName] ?? '').trim();
  const entries = parseJsonColumn(raw);

  if (entries.length === 0) {
    // No JSON data — return original row with empty synthetic columns
    return [{
      ...row,
      [JSON_COL_DATE]:    '',
      [JSON_COL_VEHICLE]: '',
      [JSON_COL_STOCK]:   '',
    }];
  }

  // One output row per JSON entry
  return entries.map(entry => ({
    ...row,
    [JSON_COL_DATE]:    entry.prospected_date ?? '',
    [JSON_COL_VEHICLE]: entry.vehicle_title ?? '',
    [JSON_COL_STOCK]:   entry.stock_number ?? '',
  }));
}

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

  // ---------------------------------------------------------------------------
  // JSON column mode state
  // WHY: These two state values control the new generic JSON feature.
  // hasJsonColumn = user declared this file has a JSON column (checkbox)
  // jsonColumnName = which column they picked from the dropdown
  // ---------------------------------------------------------------------------
  const [hasJsonColumn, setHasJsonColumn] = useState(false);
  const [jsonColumnName, setJsonColumnName] = useState<string>(NONE);

  useEffect(() => {
    if (!activeOrgId) return;
    supabase.from('vendors').select('id, name').eq('organization_id', activeOrgId).order('name')
      .then(({ data }) => setVendors((data ?? []) as Vendor[]));
  }, [activeOrgId]);

  // ---------------------------------------------------------------------------
  // WHY: When the user enables JSON mode AND picks a column, we explode all
  // rows immediately and inject the synthetic columns into headers/rows state
  // so the mapping UI and previews reflect the exploded data automatically.
  // ---------------------------------------------------------------------------
  const effectiveRows = useMemo(() => {
    if (!hasJsonColumn || jsonColumnName === NONE || rows.length === 0) return rows;
    return rows.flatMap(row => explodeRow(row, jsonColumnName));
  }, [rows, hasJsonColumn, jsonColumnName]);

  const effectiveHeaders = useMemo(() => {
    if (!hasJsonColumn || jsonColumnName === NONE) return headers;
    const syntheticCols = [JSON_COL_DATE, JSON_COL_VEHICLE, JSON_COL_STOCK];
    // Add synthetic columns only if not already present
    const existing = new Set(headers);
    const toAdd = syntheticCols.filter(c => !existing.has(c));
    return [...headers, ...toAdd];
  }, [headers, hasJsonColumn, jsonColumnName]);

  // Auto-map synthetic columns to the right fields when JSON mode is activated
  useEffect(() => {
    if (!hasJsonColumn || jsonColumnName === NONE) return;
    setMapping(prev => ({
      ...prev,
      lead_date:    JSON_COL_DATE,
      vehicle:      JSON_COL_VEHICLE,
      stock_number: JSON_COL_STOCK,
    }));
  }, [hasJsonColumn, jsonColumnName]);

  const onFile = async (f: File | null) => {
    // WHY: Block non-CSV files immediately with a clear error. XLSX/XLS files
    // cause silent date parsing failures and Select crashes. Only allow
    // .csv, .tsv, and .txt which PapaParse handles correctly.
    if (f) {
      const allowed = ['.csv', '.tsv', '.txt'];
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (!allowed.includes(ext)) {
        toast.error(`Unsupported file type: ${f.name}`, {
          description: 'Please upload a CSV file. Excel files (.xlsx/.xls) are not supported — export your spreadsheet as CSV first.',
        });
        return;
      }
    }
    setFile(f);
    setRows([]);
    setHeaders([]);
    setResult(null);
    setHasJsonColumn(false);
    setJsonColumnName(NONE);
    if (!f) return;

    let csvText: string;
    try {
      csvText = await readFileWithEncodingDetection(f);
    } catch (err: any) {
      toast.error(`Could not read file: ${err.message}`);
      return;
    }

    Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      delimiter: '',
      complete: (res) => {
        // WHY: Radix UI Select crashes if any SelectItem has value="". Filter empty headers.
        const hdrs = (res.meta.fields ?? []).filter(h => h.trim() !== '');
        const data = res.data as Record<string, string>[];
        setHeaders(hdrs);
        setRows(data);

        // Auto-map flat columns
        const m: Partial<Record<FieldKey, string>> = {};
        for (const field of FIELDS) {
          const guess = guessColumn(hdrs, [...field.candidates]);
          if (guess) m[field.key] = guess;
        }
        setMapping(m as Record<FieldKey, string>);
        toast.success(`Parsed ${data.length} rows`);
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  };

  const preview = useMemo(() => effectiveRows.slice(0, 5), [effectiveRows]);

  // Build normalized preview
  const normalizedPreview = useMemo(() => {
    if (preview.length === 0) return [] as Record<string, any>[];
    const get = (row: Record<string, string>, key: FieldKey) => {
      const col = mapping[key];
      if (!col || col === NONE) return '';
      return (row[col] ?? '').toString().trim();
    };
    const toNum = (s: string): number | null => {
      if (!s) return null;
      const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? null : n;
    };
    const toInt = (s: string): number | null => {
      const n = toNum(s);
      return n === null ? null : Math.round(n);
    };
    return preview.map((row) => {
      const fullName = get(row, 'full_name') ||
        [get(row, 'first_name'), get(row, 'last_name')].filter(Boolean).join(' ');
      const email = get(row, 'email');
      const phone = get(row, 'phone');
      const veh = get(row, 'vehicle') || '';
      const vin = get(row, 'vin');
      const parsed = parseVehicle(veh);
      const firstMapped = mapping['first_name'] && mapping['first_name'] !== NONE;
      const lastMapped = mapping['last_name'] && mapping['last_name'] !== NONE;
      const { first, last } = (!firstMapped && !lastMapped) ? splitName(fullName) : { first: '', last: '' };
      const yearRaw = get(row, 'year');
      const yearNum = yearRaw ? parseInt(yearRaw, 10) : NaN;
      return {
        customer_first_name: firstMapped ? (get(row, 'first_name') || null) : (first || null),
        customer_last_name: lastMapped ? (get(row, 'last_name') || null) : (last || null),
        customer_full_name: fullName || null,
        customer_email: email || null,
        customer_phone: phone || null,
        normalized_email: normalizeEmail(email) || null,
        normalized_phone: normalizePhone(phone) || null,
        vin: vin || null,
        vehicle_year: !isNaN(yearNum) ? yearNum : parsed.year,
        vehicle_make: get(row, 'make') || parsed.make,
        vehicle_model: get(row, 'model') || parsed.model,
        vehicle_of_interest: veh || null,
        vehicle_trim: get(row, 'trim') || null,
        body_style: get(row, 'body_style') || null,
        dol: toInt(get(row, 'dol')),
        last_price: toNum(get(row, 'last_price')),
        lotlinx_vdp: toInt(get(row, 'lotlinx_vdp')),
        total_vdp: toInt(get(row, 'total_vdp')),
        net_new_shoppers: toInt(get(row, 'net_new_shoppers')),
        pct_sales_opps_since_campaign: toNum(get(row, 'pct_sales_opps')),
        lead_date: parseLeadDate(get(row, 'lead_date')) ?? '(today — no value found)',
        source_label: get(row, 'source') || null,
        type_of_vehicle: get(row, 'type_of_vehicle') || null,
        type_of_leads: get(row, 'type_of_leads') || null,
        stock_number: get(row, 'stock_number') || null,
        lead_status: 'new',
      };
    });
  }, [preview, mapping]);

  // Name column sanity check
  const nameWarnings = useMemo(() => {
    if (effectiveRows.length === 0) return [] as { field: string; column: string; samples: string[]; count: number }[];
    const fieldsToCheck: { key: FieldKey; label: string }[] = [
      { key: 'first_name', label: 'First name' },
      { key: 'last_name', label: 'Last name' },
      { key: 'full_name', label: 'Full name' },
    ];
    const sample = effectiveRows.slice(0, 50);
    const out: { field: string; column: string; samples: string[]; count: number }[] = [];
    for (const f of fieldsToCheck) {
      const col = mapping[f.key];
      if (!col || col === NONE) continue;
      const bad: string[] = [];
      for (const r of sample) {
        const v = (r[col] ?? '').toString().trim();
        if (looksNonHuman(v)) bad.push(v);
      }
      if (bad.length > 0) {
        out.push({ field: f.label, column: col, samples: Array.from(new Set(bad)).slice(0, 3), count: bad.length });
      }
    }
    return out;
  }, [effectiveRows, mapping]);

  // ---------------------------------------------------------------------------
  // ingest — the import function
  // WHY: We now iterate over effectiveRows (already exploded if JSON mode is on)
  // instead of raw rows. Each exploded row becomes its own lead record with its
  // own stock_number and lead_date from the JSON entry. The dedup hash includes
  // stock_number + lead_date so two entries from the same customer but different
  // vehicles/dates are treated as distinct leads (not duplicates).
  // ---------------------------------------------------------------------------
  const ingest = async () => {
    if (!activeOrgId || !user || !file) return;
    if (effectiveRows.length === 0) return toast.error('No rows to import');
    setBusy(true);
    try {
      // 1. Create raw upload record
      const { data: upload, error: upErr } = await supabase
        .from('raw_lead_uploads')
        .insert({
          organization_id: activeOrgId,
          vendor_id: vendorId === NONE ? null : vendorId,
          uploaded_by: user.id,
          filename: file.name,
          row_count: effectiveRows.length,
          column_mapping: mapping,
          raw_rows: rows.slice(0, 1000), // store original rows (pre-explode) capped for storage
        })
        .select('id')
        .single();
      if (upErr || !upload) throw upErr ?? new Error('Upload create failed');

      // 2. Build leads with normalization + dedup
      const get = (row: Record<string, string>, key: FieldKey) => {
        const col = mapping[key];
        if (!col || col === NONE) return '';
        return (row[col] ?? '').toString().trim();
      };

      const toNum = (s: string): number | null => {
        if (!s) return null;
        const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? null : n;
      };
      const toInt = (s: string): number | null => {
        const n = toNum(s);
        return n === null ? null : Math.round(n);
      };

      const seenHashes = new Set<string>();
      const toInsert: any[] = [];
      let dupesInBatch = 0;

      for (const row of effectiveRows) {
        const fullName = get(row, 'full_name') ||
          [get(row, 'first_name'), get(row, 'last_name')].filter(Boolean).join(' ');
        const email = get(row, 'email');
        const phone = get(row, 'phone');
        const veh = get(row, 'vehicle') || '';
        const vin = get(row, 'vin');
        const stockNumber = get(row, 'stock_number') || null;
        const leadDateRaw = get(row, 'lead_date');

        // Skip truly empty rows
        if (!fullName && !email && !phone && !veh && !vin) continue;

        const normEmail = normalizeEmail(email);
        const normPhone = normalizePhone(phone);
        const parsed = parseVehicle(veh);
        const firstMapped = mapping['first_name'] && mapping['first_name'] !== NONE;
        const lastMapped = mapping['last_name'] && mapping['last_name'] !== NONE;
        const { first, last } = (!firstMapped && !lastMapped) ? splitName(fullName) : { first: '', last: '' };

        const yearRaw = get(row, 'year');
        const yearNum = yearRaw ? parseInt(yearRaw, 10) : NaN;
        const explicitYear = !isNaN(yearNum) ? yearNum : null;
        const explicitMake = get(row, 'make') || null;
        const explicitModel = get(row, 'model') || null;

        // WHY: The dedup hash now includes stock_number AND lead_date.
        // This means two exploded rows from the same customer but different
        // vehicles (different stock + date) will each get a unique hash and
        // both be inserted as separate lead records — which is exactly what
        // we need for lead-to-sale matching later.
        const hash = await buildDedupHash({
          email: normEmail,
          phone: normPhone,
          name: normalizeName(fullName),
          vehicle: normalizeName(veh || vin),
          vin: vin || null,
          stock_number: stockNumber,
          lead_date: parseLeadDate(leadDateRaw) ?? null,
        });

        if (seenHashes.has(hash)) { dupesInBatch++; continue; }
        seenHashes.add(hash);

        toInsert.push({
          organization_id: activeOrgId,
          vendor_id: vendorId === NONE ? null : vendorId,
          raw_upload_id: upload.id,
          customer_first_name: firstMapped ? (get(row, 'first_name') || null) : (first || null),
          customer_last_name: lastMapped ? (get(row, 'last_name') || null) : (last || null),
          customer_full_name: fullName || null,
          customer_email: email || null,
          customer_phone: phone || null,
          normalized_email: normEmail,
          normalized_phone: normPhone,
          dedup_hash: hash,
          vehicle_of_interest: veh || null,
          vehicle_year: explicitYear ?? parsed.year,
          vehicle_make: explicitMake ?? parsed.make,
          vehicle_model: explicitModel ?? parsed.model,
          vin: vin || null,
          vehicle_trim: get(row, 'trim') || null,
          body_style: get(row, 'body_style') || null,
          dol: toInt(get(row, 'dol')),
          last_price: toNum(get(row, 'last_price')),
          lotlinx_vdp: toInt(get(row, 'lotlinx_vdp')),
          total_vdp: toInt(get(row, 'total_vdp')),
          net_new_shoppers: toInt(get(row, 'net_new_shoppers')),
          pct_sales_opps_since_campaign: toNum(get(row, 'pct_sales_opps')),
          lead_date: parseLeadDate(leadDateRaw) ?? new Date().toISOString(),
          source_label: get(row, 'source') || null,
          type_of_vehicle: get(row, 'type_of_vehicle') || null,
          type_of_leads: get(row, 'type_of_leads') || null,
          stock_number: stockNumber,
          lead_status: 'new',
        });
      }

      // 3. Dedup against existing leads in this org by hash
      let existingDupes = 0;
      if (toInsert.length > 0) {
        const hashes = toInsert.map(r => r.dedup_hash);
        const { data: existing } = await supabase
          .from('leads')
          .select('dedup_hash')
          .eq('organization_id', activeOrgId)
          .in('dedup_hash', hashes);
        const existingSet = new Set((existing ?? []).map(e => e.dedup_hash));
        const filtered = toInsert.filter(r => {
          if (existingSet.has(r.dedup_hash)) { existingDupes++; return false; }
          return true;
        });

        // 4. Insert in chunks
        const CHUNK = 200;
        let inserted = 0;
        for (let i = 0; i < filtered.length; i += CHUNK) {
          const slice = filtered.slice(i, i + CHUNK);
          const { error: insErr } = await supabase.from('leads').insert(slice);
          if (insErr) throw insErr;
          inserted += slice.length;
        }

        await supabase.from('raw_lead_uploads').update({
          inserted_count: inserted,
          duplicate_count: dupesInBatch + existingDupes,
        }).eq('id', upload.id);

        setResult({ inserted, duplicates: dupesInBatch + existingDupes });
        toast.success(`Imported ${inserted} leads (${dupesInBatch + existingDupes} duplicates skipped). Go to Leads to see the full list.`);
      } else {
        setResult({ inserted: 0, duplicates: dupesInBatch });
        toast.warning('No valid rows found');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload Leads (CSV)</h1>
        <p className="text-sm text-muted-foreground">
          For {activeOrg?.name}. Map your columns — duplicates are skipped automatically.
        </p>
      </div>

      {/* Step 1: File + Vendor */}
      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose file & vendor</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>CSV file</Label>
            <Input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              onChange={e => onFile(e.target.files?.[0] ?? null)}
            />
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

      {/* Step 2: JSON column declaration — only shown after a file is loaded */}
      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. JSON column (optional)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Some vendors (e.g. TruckPro) store multiple vehicle entries as a JSON array inside one column.
              Enable this if your file has such a column — each JSON entry will become its own lead record.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            {/* Checkbox */}
            <div className="flex items-center gap-3">
              <input
                id="has-json-col"
                type="checkbox"
                className="h-4 w-4 cursor-pointer"
                checked={hasJsonColumn}
                onChange={e => {
                  setHasJsonColumn(e.target.checked);
                  if (!e.target.checked) {
                    setJsonColumnName(NONE);
                    // Remove auto-mapped synthetic columns from mapping
                    setMapping(prev => {
                      const next = { ...prev };
                      if (next['lead_date'] === JSON_COL_DATE) delete next['lead_date'];
                      if (next['vehicle'] === JSON_COL_VEHICLE) delete next['vehicle'];
                      if (next['stock_number'] === JSON_COL_STOCK) delete next['stock_number'];
                      return next;
                    });
                  }
                }}
              />
              <Label htmlFor="has-json-col" className="cursor-pointer">
                This file contains a JSON column
              </Label>
            </div>

            {/* Column picker — shown only when checkbox is checked */}
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
                  <Select
                    value={mapping[f.key] || NONE}
                    onValueChange={v => setMapping(prev => ({ ...prev, [f.key]: v }))}
                  >
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
                <thead>
                  <tr className="border-b">
                    {effectiveHeaders.map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b">
                      {effectiveHeaders.map(h => <td key={h} className="px-2 py-1 text-muted-foreground">{r[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Step 5: Mapped preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">5. Mapped preview — how it will be imported</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Only mapped fields are shown. Yellow/red cells flag suspicious values (e.g. $ or pure numbers in name fields).
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {(() => {
                const mappedFields = FIELDS.filter(f => mapping[f.key] && mapping[f.key] !== NONE);
                if (mappedFields.length === 0) {
                  return <p className="text-xs text-muted-foreground">No fields mapped yet.</p>;
                }
                const nameKeys = new Set(['first_name', 'last_name', 'full_name']);
                return (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        {mappedFields.map(f => (
                          <th key={f.key} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                            <div className="text-foreground">{f.label}</div>
                            <div className="text-[10px] font-normal text-muted-foreground">
                              ← {mapping[f.key]}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i} className="border-b">
                          {mappedFields.map(f => {
                            const v = (r[mapping[f.key]] ?? '').toString().trim();
                            const flag = nameKeys.has(f.key) && looksNonHuman(v);
                            return (
                              <td
                                key={f.key}
                                className={`px-2 py-1 whitespace-nowrap ${flag ? 'bg-destructive/10 text-destructive font-medium' : 'text-muted-foreground'}`}
                                title={flag ? 'Looks like a price/number — not a name' : undefined}
                              >
                                {v || <span className="text-muted-foreground/50">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </CardContent>
          </Card>

          {/* Step 6: Normalized preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">6. Final preview — first 5 records exactly as they will be saved</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Includes normalization: split first/last name, parsed year/make/model from VOI, parsed dates, normalized phone/email. Empty values display as <code className="px-1 rounded bg-muted">null</code>.
              </p>
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
                        {normalizedPreview.map((_, i) => (
                          <th key={i} className="px-2 py-1 text-left font-medium whitespace-nowrap">Row {i + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(normalizedPreview[0]).map(field => (
                        <tr key={field} className="border-b">
                          <td className="px-2 py-1 font-medium whitespace-nowrap text-foreground">{field}</td>
                          {normalizedPreview.map((row, i) => {
                            const v = (row as any)[field];
                            const display = v === null || v === undefined || v === ''
                              ? <span className="text-muted-foreground/50 italic">null</span>
                              : String(v);
                            return (
                              <td key={i} className="px-2 py-1 align-top whitespace-nowrap text-muted-foreground">
                                {display}
                              </td>
                            );
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
                {result.inserted > 0 && (
                  <Button variant="outline" asChild>
                    <Link to="/leads">View Leads →</Link>
                  </Button>
                )}
              </div>
            )}
            <Button
              onClick={ingest}
              disabled={busy || nameWarnings.length > 0 || vendorId === NONE || (hasJsonColumn && jsonColumnName === NONE)}
              className="ml-auto"
              title={
                vendorId === NONE
                  ? 'Select a vendor before importing'
                  : hasJsonColumn && jsonColumnName === NONE
                  ? 'Select which column contains the JSON'
                  : nameWarnings.length > 0
                  ? 'Fix name column mapping above to enable import'
                  : undefined
              }
            >
              <UploadIcon className="mr-1 h-4 w-4" />
              {busy
                ? 'Importing...'
                : vendorId === NONE
                  ? 'Select a vendor to import'
                  : hasJsonColumn && jsonColumnName === NONE
                  ? 'Select JSON column to import'
                  : nameWarnings.length > 0
                  ? 'Fix mapping to import'
                  : `Import ${effectiveRows.length} rows`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
