import { useEffect, useMemo, useState } from 'react';
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
  { key: 'lead_date', label: 'Lead date', candidates: ['lead date', 'date', 'created', 'submitted', 'timestamp'] },
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
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

const NONE = '__none__';

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

  useEffect(() => {
    if (!activeOrgId) return;
    supabase.from('vendors').select('id, name').eq('organization_id', activeOrgId).order('name')
      .then(({ data }) => setVendors((data ?? []) as Vendor[]));
  }, [activeOrgId]);

  const onFile = (f: File | null) => {
    setFile(f);
    setRows([]);
    setHeaders([]);
    setResult(null);
    if (!f) return;
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hdrs = res.meta.fields ?? [];
        setHeaders(hdrs);
        setRows(res.data);
        // auto-map
        const m: Partial<Record<FieldKey, string>> = {};
        for (const f of FIELDS) {
          const guess = guessColumn(hdrs, [...f.candidates]);
          if (guess) m[f.key] = guess;
        }
        setMapping(m as Record<FieldKey, string>);
        toast.success(`Parsed ${res.data.length} rows`);
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  };

  const preview = useMemo(() => rows.slice(0, 5), [rows]);

  // Sanity check: warn when name columns contain $ or pure numbers (sign of a misclassified column)
  const nameWarnings = useMemo(() => {
    if (rows.length === 0) return [] as { field: string; column: string; samples: string[]; count: number }[];
    const fieldsToCheck: { key: FieldKey; label: string }[] = [
      { key: 'first_name', label: 'First name' },
      { key: 'last_name', label: 'Last name' },
      { key: 'full_name', label: 'Full name' },
    ];
    const sample = rows.slice(0, 50);
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
  }, [rows, mapping]);

  const ingest = async () => {
    if (!activeOrgId || !user || !file) return;
    if (rows.length === 0) return toast.error('No rows to import');
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
          row_count: rows.length,
          column_mapping: mapping,
          raw_rows: rows.slice(0, 1000), // cap for storage
        })
        .select('id')
        .single();
      if (upErr || !upload) throw upErr ?? new Error('Upload create failed');

      // 2. Build leads with normalization + per-batch dedup
      const get = (row: Record<string, string>, key: FieldKey) => {
        const col = mapping[key];
        if (!col || col === NONE) return '';
        return (row[col] ?? '').toString().trim();
      };

      const seenHashes = new Set<string>();
      const toInsert: any[] = [];
      let dupesInBatch = 0;

      for (const row of rows) {
        const fullName = get(row, 'full_name') ||
          [get(row, 'first_name'), get(row, 'last_name')].filter(Boolean).join(' ');
        const email = get(row, 'email');
        const phone = get(row, 'phone');
        const veh = get(row, 'vehicle');
        const vin = get(row, 'vin');

        // Skip only truly empty rows (no identifier of any kind)
        if (!fullName && !email && !phone && !veh && !vin) continue;

        const normEmail = normalizeEmail(email);
        const normPhone = normalizePhone(phone);
        const parsed = parseVehicle(veh);
        const { first, last } = splitName(fullName);

        // Prefer explicit Year/Make/Model columns; fall back to parsed VOI text
        const yearRaw = get(row, 'year');
        const yearNum = yearRaw ? parseInt(yearRaw, 10) : NaN;
        const explicitYear = !isNaN(yearNum) ? yearNum : null;
        const explicitMake = get(row, 'make') || null;
        const explicitModel = get(row, 'model') || null;

        const toNum = (s: string): number | null => {
          if (!s) return null;
          const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
          return isNaN(n) ? null : n;
        };
        const toInt = (s: string): number | null => {
          const n = toNum(s);
          return n === null ? null : Math.round(n);
        };

        const hash = await buildDedupHash({
          email: normEmail,
          phone: normPhone,
          name: normalizeName(fullName),
          vehicle: normalizeName(veh || vin),
        });
        if (seenHashes.has(hash)) { dupesInBatch++; continue; }
        seenHashes.add(hash);

        toInsert.push({
          organization_id: activeOrgId,
          vendor_id: vendorId === NONE ? null : vendorId,
          raw_upload_id: upload.id,
          customer_first_name: first || get(row, 'first_name') || null,
          customer_last_name: last || get(row, 'last_name') || null,
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
          lead_date: parseLeadDate(get(row, 'lead_date')) ?? new Date().toISOString(),
          source_label: get(row, 'source') || null,
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
        toast.success(`Imported ${inserted} leads (${dupesInBatch + existingDupes} duplicates skipped)`);
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

      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose file & vendor</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>CSV file</Label>
            <Input type="file" accept=".csv,text/csv" onChange={e => onFile(e.target.files?.[0] ?? null)} />
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

      {headers.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" /> 2. Map columns
                <Badge variant="secondary" className="ml-2">{rows.length} rows</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {FIELDS.map(f => (
                <div key={f.key} className="grid gap-1">
                  <Label className="text-xs">{f.label}</Label>
                  <Select
                    value={mapping[f.key] ?? NONE}
                    onValueChange={v => setMapping(prev => ({ ...prev, [f.key]: v === NONE ? '' : v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Skip —</SelectItem>
                      {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">3. Preview (first 5 rows)</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    {headers.map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b">
                      {headers.map(h => <td key={h} className="px-2 py-1 text-muted-foreground">{r[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
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
                      This usually means the column contains a price or count, not a person's name. Re-map or set to “Skip”.
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between gap-3">
            {result && (
              <div className="text-sm">
                <Badge className="mr-2">{result.inserted} inserted</Badge>
                <Badge variant="secondary">{result.duplicates} duplicates skipped</Badge>
              </div>
            )}
            <Button
              onClick={ingest}
              disabled={busy || nameWarnings.length > 0}
              className="ml-auto"
              title={nameWarnings.length > 0 ? 'Fix name column mapping above to enable import' : undefined}
            >
              <UploadIcon className="mr-1 h-4 w-4" />
              {busy
                ? 'Importing...'
                : nameWarnings.length > 0
                  ? 'Fix mapping to import'
                  : `Import ${rows.length} rows`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
