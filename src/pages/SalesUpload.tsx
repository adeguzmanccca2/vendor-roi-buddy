import { useMemo, useState } from 'react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload as UploadIcon, FileSpreadsheet, Wand2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  buildDedupHash,
  guessColumn,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeRevenue,
  parseLeadDate,
  parseVehicle,
  splitName,
} from '@/lib/normalize';

const FIELDS = [
  { key: 'row_number', label: 'Row #', candidates: ['row', 'row #', 'row number', '#'] },
  { key: 'full_name', label: 'Name', candidates: ['name', 'full name', 'customer name', 'buyer', 'buyer name'] },
  { key: 'first_name', label: 'First name', candidates: ['first name', 'firstname', 'first', 'fname', 'buyer first'] },
  { key: 'last_name', label: 'Last name', candidates: ['last name', 'lastname', 'last', 'lname', 'surname', 'buyer last'] },
  { key: 'address', label: 'Address', candidates: ['address', 'street', 'street address'] },
  { key: 'city', label: 'City', candidates: ['city'] },
  { key: 'state', label: 'State', candidates: ['state', 'province'] },
  { key: 'zip_code', label: 'Zip code', candidates: ['zip', 'zip code', 'postal', 'postal code'] },
  { key: 'birthday', label: 'Birthday', candidates: ['birthday', 'birth date', 'dob', 'date of birth'] },
  { key: 'email', label: 'Email address', candidates: ['email', 'e-mail', 'email address', 'customer email', 'buyer email'] },
  { key: 'home_phone', label: 'Home phone', candidates: ['home phone', 'home', 'home tel'] },
  { key: 'phone', label: 'Cell phone', candidates: ['cell phone', 'cell', 'mobile', 'mobile phone'] },
  { key: 'work_phone', label: 'Work phone', candidates: ['work phone', 'work', 'office phone'] },
  { key: 'stock_number', label: 'Stock #', candidates: ['stock', 'stock number', 'stock#', 'stock #'] },
  { key: 'vin', label: 'VIN', candidates: ['vin', 'vehicle vin', 'vin #', 'vin number'] },
  { key: 'vehicle', label: 'Vehicle (year/make/model)', candidates: ['vehicle', 'sold vehicle', 'unit', 'description'] },
  { key: 'date_active', label: 'Date active', candidates: ['date active', 'active date', 'first active'] },
  { key: 'sale_date', label: 'Date sold', candidates: ['date sold', 'sale date', 'sold date', 'deal date', 'closed', 'delivery date'] },
  { key: 'front_gross', label: 'Front', candidates: ['front', 'front gross', 'fe gross'] },
  { key: 'back_gross', label: 'Back', candidates: ['back', 'back gross', 'be gross', 'fi gross'] },
  { key: 'total_gross', label: 'Total', candidates: ['total', 'total gross'] },
  { key: 'sale_price', label: 'Sale price', candidates: ['sale price', 'price', 'amount'] },
  { key: 'gross_revenue', label: 'Gross revenue', candidates: ['gross', 'revenue'] },
  { key: 'profit_loss', label: 'P/L', candidates: ['p/l', 'pl', 'profit/loss', 'profit loss'] },
  { key: 'new_used', label: 'N/U', candidates: ['n/u', 'nu', 'new/used', 'new used', 'condition'] },
  { key: 'salesperson', label: 'Salesperson', candidates: ['salesperson', 'sales rep', 'rep', 'sold by'] },
  { key: 'fi_manager', label: 'FI Manager', candidates: ['fi manager', 'f&i manager', 'finance manager', 'fi mgr'] },
  { key: 'up_type', label: 'Up Type', candidates: ['up type', 'up', 'lead type'] },
  { key: 'source', label: 'Source', candidates: ['source', 'lead source', 'origin'] },
  { key: 'deal_status', label: 'Deal status', candidates: ['deal status', 'status'] },
  { key: 'dms_deal_id', label: 'DMS Deal ID', candidates: ['dms deal id', 'dms id', 'deal id', 'deal #', 'deal number', 'deal#', 'invoice'] },
  { key: 'inventory_acquired_date', label: 'Inventory acquired date', candidates: ['inventory acquired date', 'acquired date', 'inventory date', 'in stock date'] },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];
const NONE = '__none__';

export default function SalesUploadPage() {
  const { user } = useAuth();
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({} as any);
  const [busy, setBusy] = useState(false);
  const [attributing, setAttributing] = useState(false);
  const [result, setResult] = useState<{ inserted: number; duplicates: number; uploadId: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [rowSkips, setRowSkips] = useState<{ row: number; reason: string }[]>([]);

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

  const ingest = async () => {
    if (!activeOrgId || !user || !file) return;
    if (rows.length === 0) return toast.error('No rows to import');
    setBusy(true);
    setImportError(null);
    setRowSkips([]);
    try {
      const { data: upload, error: upErr } = await supabase
        .from('raw_sales_uploads')
        .insert({
          organization_id: activeOrgId,
          uploaded_by: user.id,
          filename: file.name,
          row_count: rows.length,
          column_mapping: mapping,
          raw_rows: rows.slice(0, 1000),
        })
        .select('id')
        .single();
      if (upErr || !upload) throw upErr ?? new Error('Upload create failed');

      const get = (row: Record<string, string>, key: FieldKey) => {
        const col = mapping[key];
        if (!col || col === NONE) return '';
        return (row[col] ?? '').toString().trim();
      };

      const seenHashes = new Set<string>();
      const toInsert: any[] = [];
      let dupesInBatch = 0;

      const rowErrors: { row: number; reason: string }[] = [];

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        try {
          const fullName = get(row, 'full_name') ||
            [get(row, 'first_name'), get(row, 'last_name')].filter(Boolean).join(' ');
          const email = get(row, 'email');
          const phone = get(row, 'phone');
          const homePhone = get(row, 'home_phone');
          const workPhone = get(row, 'work_phone');
          const vin = get(row, 'vin');
          const stock = get(row, 'stock_number');
          const dmsId = get(row, 'dms_deal_id');

          // Skip only fully empty rows (no identifying info at all)
          if (!fullName && !email && !phone && !homePhone && !workPhone && !vin && !stock && !dmsId) {
            rowErrors.push({ row: rowIdx + 2, reason: 'no identifying info' });
            continue;
          }

          const normEmail = normalizeEmail(email);
          const normPhone = normalizePhone(phone) ?? normalizePhone(homePhone) ?? normalizePhone(workPhone);
          const veh = get(row, 'vehicle');
          const parsed = parseVehicle(veh);
          const { first, last } = splitName(fullName);
          const sd = parseLeadDate(get(row, 'sale_date'));
          const dActive = parseLeadDate(get(row, 'date_active'));
          const bday = parseLeadDate(get(row, 'birthday'));
          const invAcq = parseLeadDate(get(row, 'inventory_acquired_date'));

          const front = normalizeRevenue(get(row, 'front_gross')) ?? 0;
          const back = normalizeRevenue(get(row, 'back_gross')) ?? 0;
          const totalCol = normalizeRevenue(get(row, 'total_gross'));
          const gross = normalizeRevenue(get(row, 'gross_revenue')) ?? totalCol ?? (front + back);
          const total = totalCol ?? ((front + back) || gross);
          const salePrice = normalizeRevenue(get(row, 'sale_price'));

          // Dedup: prefer DMS deal id / stock# / VIN, else identity + date
          const dealKey = dmsId || stock || vin;
          const hash = await buildDedupHash({
            email: normEmail,
            phone: normPhone,
            name: normalizeName(fullName) + '|' + (sd ?? ''),
            vehicle: normalizeName(veh) + '|' + dealKey,
          });
          if (seenHashes.has(hash)) { dupesInBatch++; continue; }
          seenHashes.add(hash);

          toInsert.push({
            organization_id: activeOrgId,
            raw_upload_id: upload.id,
            customer_first_name: first || get(row, 'first_name') || null,
            customer_last_name: last || get(row, 'last_name') || null,
            customer_full_name: fullName || null,
            customer_email: email || null,
            customer_phone: phone || null,
            home_phone: homePhone || null,
            work_phone: workPhone || null,
            address: get(row, 'address') || null,
            city: get(row, 'city') || null,
            state: get(row, 'state') || null,
            zip_code: get(row, 'zip_code') || null,
            birthday: bday ? bday.slice(0, 10) : null,
            normalized_email: normEmail,
            normalized_phone: normPhone,
            dedup_hash: hash,
            vehicle_of_interest: veh || null,
            vehicle_year: parsed.year,
            vehicle_make: parsed.make,
            vehicle_model: parsed.model,
            vin: vin || null,
            stock_number: stock || null,
            deal_number: dmsId || null,
            dms_deal_id: dmsId || null,
            salesperson: get(row, 'salesperson') || null,
            fi_manager: get(row, 'fi_manager') || null,
            up_type: get(row, 'up_type') || null,
            source_label: get(row, 'source') || null,
            deal_status: get(row, 'deal_status') || null,
            profit_loss: get(row, 'profit_loss') || null,
            new_used: get(row, 'new_used') || null,
            sale_date: sd ?? new Date().toISOString(),
            date_active: dActive,
            inventory_acquired_date: invAcq ? invAcq.slice(0, 10) : null,
            gross_revenue: gross,
            front_gross: front,
            back_gross: back,
            total_gross: total,
            sale_price: salePrice,
            attribution_status: 'unmatched',
          });
        } catch (rowErr: any) {
          console.error(`[SalesUpload] row ${rowIdx + 2} failed:`, rowErr, row);
          rowErrors.push({ row: rowIdx + 2, reason: rowErr?.message ?? String(rowErr) });
        }
      }

      console.log(`[SalesUpload] prepared ${toInsert.length} rows, ${rowErrors.length} skipped`);
      setRowSkips(rowErrors);

      let existingDupes = 0;
      let inserted = 0;
      if (toInsert.length > 0) {
        const hashes = toInsert.map(r => r.dedup_hash);
        const { data: existing } = await supabase
          .from('sales')
          .select('dedup_hash')
          .eq('organization_id', activeOrgId)
          .in('dedup_hash', hashes);
        const existingSet = new Set((existing ?? []).map(e => e.dedup_hash));
        const filtered = toInsert.filter(r => {
          if (existingSet.has(r.dedup_hash)) { existingDupes++; return false; }
          return true;
        });

        const CHUNK = 50;
        for (let i = 0; i < filtered.length; i += CHUNK) {
          const slice = filtered.slice(i, i + CHUNK);
          const { error: insErr } = await supabase.from('sales').insert(slice);
          if (insErr) {
            console.error(`[SalesUpload] insert chunk ${i}-${i + slice.length} failed:`, insErr, 'sample row:', slice[0]);
            throw new Error(`DB rejected sales insert (chunk starting row ${i + 1}): ${insErr.message}${insErr.details ? ' — ' + insErr.details : ''}${insErr.hint ? ' — ' + insErr.hint : ''}`);
          }
          inserted += slice.length;
        }
      }

      await supabase.from('raw_sales_uploads').update({
        inserted_count: inserted,
        duplicate_count: dupesInBatch + existingDupes,
      }).eq('id', upload.id);

      setResult({ inserted, duplicates: dupesInBatch + existingDupes, uploadId: upload.id });
      toast.success(`Imported ${inserted} sales (${dupesInBatch + existingDupes} duplicates skipped)`);
    } catch (e: any) {
      const msg = e?.message ?? 'Import failed';
      console.error('[SalesUpload] import failed:', e);
      setImportError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const runAttribution = async () => {
    if (!activeOrgId) return;
    setAttributing(true);
    try {
      const { data, error } = await supabase.rpc('attribute_sales_for_org', { _org_id: activeOrgId });
      if (error) throw error;
      const r = Array.isArray(data) ? data[0] : data;
      toast.success(`Attribution complete: ${r?.matched ?? 0} of ${r?.total_unmatched ?? 0} sales matched`);
    } catch (e: any) {
      toast.error(e.message ?? 'Attribution failed');
    } finally {
      setAttributing(false);
    }
  };

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Upload Sales (CSV)</h1>
          <p className="text-sm text-muted-foreground">
            For {activeOrg?.name}. Import CRM/DMS sales — duplicates skipped, then run attribution.
          </p>
        </div>
        <Button variant="secondary" onClick={runAttribution} disabled={attributing}>
          <Wand2 className="mr-1 h-4 w-4" />
          {attributing ? 'Matching...' : 'Run Attribution'}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose file</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Label>CSV file</Label>
            <Input type="file" accept=".csv,text/csv" onChange={e => onFile(e.target.files?.[0] ?? null)} />
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

          {importError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Import failed</AlertTitle>
              <AlertDescription className="break-words text-xs font-mono mt-2">
                {importError}
              </AlertDescription>
            </Alert>
          )}

          {rowSkips.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{rowSkips.length} row(s) skipped during processing</AlertTitle>
              <AlertDescription className="text-xs mt-2 max-h-40 overflow-y-auto">
                <ul className="space-y-0.5">
                  {rowSkips.slice(0, 20).map(s => (
                    <li key={s.row}>Row {s.row}: {s.reason}</li>
                  ))}
                  {rowSkips.length > 20 && <li>…and {rowSkips.length - 20} more (see browser console)</li>}
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
            <Button onClick={ingest} disabled={busy} className="ml-auto">
              <UploadIcon className="mr-1 h-4 w-4" />
              {busy ? 'Importing...' : `Import ${rows.length} rows`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
