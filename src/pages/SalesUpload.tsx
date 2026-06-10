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
import { Upload as UploadIcon, FileSpreadsheet, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  guessColumn,
  normalizePhone,
  normalizeRevenue,
  parseLeadDate,
  parseVehicle,
  splitName,
} from '@/lib/normalize';

// ---------------------------------------------------------------------------
// Field definitions — only columns shown in the mapper UI
// Hidden fields (home_phone, email, birthday, gross columns, etc.) are
// intentionally excluded from the mapper but their DB columns are untouched.
// ---------------------------------------------------------------------------
const FIELDS = [
  { key: 'full_name',    label: 'Name',         candidates: ['name', 'full name', 'customer name', 'buyer', 'buyer name'] },
  { key: 'address',      label: 'Address',       candidates: ['address', 'street', 'street address'] },
  { key: 'city',         label: 'City',          candidates: ['city'] },
  { key: 'state',        label: 'State',         candidates: ['state', 'province'] },
  { key: 'zip_code',     label: 'Zip code',      candidates: ['zip', 'zip code', 'postal', 'postal code'] },
  { key: 'phone',        label: 'Cell phone',    candidates: ['cell phone', 'cell', 'mobile', 'mobile phone', 'phone', 'phone number', 'tel'] },
  { key: 'work_phone',   label: 'Work phone',    candidates: ['work phone', 'work', 'office phone'] },
  { key: 'stock_number', label: 'Stock #',       candidates: ['stock', 'stock number', 'stock#', 'stock #'] },
  { key: 'vin',          label: 'VIN',           candidates: ['vin', 'vehicle vin', 'vin #', 'vin number'] },
  { key: 'vehicle',      label: 'Vehicle',       candidates: ['vehicle', 'sold vehicle', 'unit', 'description'] },
  { key: 'sale_date',    label: 'Date sold',     candidates: ['date sold', 'sale date', 'sold date', 'deal date', 'closed', 'delivery date'] },
  { key: 'body',         label: 'Body',          candidates: ['body', 'body style', 'bodystyle', 'body type'] },
  { key: 'sale_price',   label: 'Sale price',    candidates: ['sale price', 'price', 'amount'] },
  { key: 'salesperson',  label: 'Salesperson',   candidates: ['salesperson', 'sales rep', 'rep', 'sold by'] },
  { key: 'lending_name', label: 'Lending name',  candidates: ['lending name', 'lender', 'lender name', 'finance source', 'bank'] },
  { key: 'notes',        label: 'Notes',         candidates: ['notes', 'note', 'comments', 'comment', 'remarks', 'memo'] },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];
const NONE = '__none__';

// ---------------------------------------------------------------------------
// Deduplication helpers — VIN and Stock# only
// ---------------------------------------------------------------------------

/**
 * Normalize a VIN: uppercase, strip ALL non-alphanumeric characters
 * (spaces, dashes, tabs, invisible chars from DMS exports).
 * Returns null if fewer than 5 chars after cleaning.
 */
function normVin(raw: string): string | null {
  const v = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return v.length >= 5 ? v : null;
}

/**
 * Normalize a stock number: uppercase, strip ALL non-alphanumeric characters.
 * Returns null if fewer than 2 chars after cleaning.
 */
function normStock(raw: string): string | null {
  const v = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return v.length >= 2 ? v : null;
}

// ---------------------------------------------------------------------------
// Skipped-row detail type
// ---------------------------------------------------------------------------
interface SkippedRow {
  row: number;
  name: string;
  vin: string;
  stock: string;
  reason: string;        // 'Duplicate within file' | 'Already in database'
  matchedOn: 'VIN' | 'Stock#' | 'none';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function SalesUploadPage() {
  const { user } = useAuth();
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({} as any);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; duplicates: number; skippedRows: SkippedRow[]; uploadId: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [rowSkips, setRowSkips] = useState<{ row: number; reason: string }[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  // ── File picker ────────────────────────────────────────────────────────────
  const onFile = (f: File | null) => {
    setFile(f);
    setRows([]);
    setHeaders([]);
    setResult(null);
    setImportError(null);
    setRowSkips([]);
    setImportStatus(null);
    setShowSkipped(false);
    if (!f) return;
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hdrs = (res.meta.fields ?? []).filter(h => h.trim() !== '');
        setHeaders(hdrs);
        setRows(res.data);
        const m: Partial<Record<FieldKey, string>> = {};
        for (const field of FIELDS) {
          const guess = guessColumn(hdrs, [...field.candidates]);
          if (guess) m[field.key] = guess;
        }
        setMapping(m as Record<FieldKey, string>);
        toast.success(`Parsed ${res.data.length} rows`);
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  };

  const preview = useMemo(() => rows.slice(0, 5), [rows]);

  // ── Main ingest ────────────────────────────────────────────────────────────
  const ingest = async () => {
    if (!activeOrgId || !user || !file) return;
    if (rows.length === 0) return toast.error('No rows to import');
    setBusy(true);
    setImportError(null);
    setRowSkips([]);
    setResult(null);
    setShowSkipped(false);
    setImportStatus('Creating upload record...');

    try {
      // ── Timeout wrapper ────────────────────────────────────────────────────
      const withTimeout = async <T,>(promise: PromiseLike<T>, label: string, ms = 30000): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} seconds`)),
                ms,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      // ── Step 1: Create upload record ───────────────────────────────────────
      const { data: upload, error: upErr } = await withTimeout(
        supabase
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
          .single(),
        'Creating upload record',
      );
      if (upErr || !upload) throw upErr ?? new Error('Upload create failed');

      // ── Step 2: Parse & normalize every CSV row ────────────────────────────
      const get = (row: Record<string, string>, key: FieldKey) => {
        const col = mapping[key];
        if (!col || col === NONE) return '';
        return (row[col] ?? '').toString().trim();
      };

      // Dedup sets — one per identifier type, scoped to THIS file first,
      // then checked against the DB. VIN is global-unique; Stock# is unique per org.
      const seenVins   = new Set<string>(); // tracks VINs seen in this file
      const seenStocks = new Set<string>(); // tracks Stock#s seen in this file

      // Rows ready to insert (pending DB dedup check)
      const toInsert: any[] = [];

      // Rows skipped due to no identifying info or parse errors
      const rowErrors: { row: number; reason: string }[] = [];

      // Rows skipped as duplicates — full detail for the result UI
      const dupesDetail: SkippedRow[] = [];
      let dupesInBatch = 0;

      setImportStatus(`Preparing ${rows.length} rows...`);

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        try {
          const fullName  = get(row, 'full_name');
          const phone     = get(row, 'phone');
          const vin       = get(row, 'vin');
          const stock     = get(row, 'stock_number');

          // Skip completely empty rows
          if (!fullName && !phone && !vin && !stock) {
            rowErrors.push({ row: rowIdx + 2, reason: 'no identifying info' });
            continue;
          }

          // Normalize VIN and Stock# for comparison
          const nVin   = normVin(vin);
          const nStock = normStock(stock);

          // ── Within-file dedup ─────────────────────────────────────────────
          if (nVin && seenVins.has(nVin)) {
            dupesInBatch++;
            dupesDetail.push({ row: rowIdx + 2, name: fullName, vin, stock, reason: 'Duplicate within file', matchedOn: 'VIN' });
            continue;
          }
          if (nStock && seenStocks.has(nStock)) {
            dupesInBatch++;
            dupesDetail.push({ row: rowIdx + 2, name: fullName, vin, stock, reason: 'Duplicate within file', matchedOn: 'Stock#' });
            continue;
          }

          // Register both identifiers so later rows in this file can match them
          if (nVin)   seenVins.add(nVin);
          if (nStock) seenStocks.add(nStock);

          // Parse remaining fields
          const normPhone = normalizePhone(phone) ?? normalizePhone(get(row, 'work_phone'));
          const veh       = get(row, 'vehicle');
          const parsed    = parseVehicle(veh);
          const { first, last } = splitName(fullName);
          const sd        = parseLeadDate(get(row, 'sale_date'));

          const salePrice = normalizeRevenue(get(row, 'sale_price')) ?? null;

          toInsert.push({
            organization_id:     activeOrgId,
            raw_upload_id:       upload.id,
            customer_first_name: first    || null,
            customer_last_name:  last     || null,
            customer_full_name:  fullName || null,
            customer_phone:      phone    || null,
            work_phone:          get(row, 'work_phone') || null,
            normalized_phone:    normPhone,
            address:             get(row, 'address')      || null,
            city:                get(row, 'city')         || null,
            state:               get(row, 'state')        || null,
            zip_code:            get(row, 'zip_code')     || null,
            vehicle_of_interest: veh || null,
            vehicle_year:        parsed.year,
            vehicle_make:        parsed.make,
            vehicle_model:       parsed.model,
            vin:                 nVin   || null,
            stock_number:        nStock || null,
            salesperson:         get(row, 'salesperson')  || null,
            sale_date:           sd ?? new Date().toISOString(),
            gross_revenue:       salePrice,
            total_gross:         salePrice,
            sale_price:          salePrice,
            body:                get(row, 'body')         || null,
            lending_name:        get(row, 'lending_name') || null,
            notes:               get(row, 'notes')        || null,
            attribution_status:  'unmatched',
            // Internal metadata — stripped before insert
            __nVin:     nVin,
            __nStock:   nStock,
            __name:     fullName,
            __vinRaw:   vin,
            __stockRaw: stock,
          });
        } catch (rowErr: any) {
          console.error(`[SalesUpload] row ${rowIdx + 2} failed:`, rowErr, row);
          rowErrors.push({ row: rowIdx + 2, reason: rowErr?.message ?? String(rowErr) });
        }
      }

      console.log(`[SalesUpload] prepared ${toInsert.length} rows, ${rowErrors.length} empty/errored, ${dupesInBatch} within-file dupes`);
      setRowSkips(rowErrors);

      // ── Step 3: DB dedup — pull existing VINs and Stock#s for this org ──────
      //
      // We only need two columns. One query, no chunking needed.
      // VIN check runs first (priority). Stock# check only fires if row has no VIN.
      //
      let existingDupes = 0;

      setImportStatus('Checking existing sales for duplicates...');

      const { data: existingRows, error: existingErr } = await withTimeout(
        supabase
          .from('sales')
          .select('vin, stock_number')
          .eq('organization_id', activeOrgId)
          .limit(10000),
        'Loading existing sales for dedup',
        45000,
      );
      if (existingErr) throw new Error(`Dedup check failed: ${existingErr.message}`);

      // Build Sets of normalized values already in the DB
      const dbVins   = new Set<string>();
      const dbStocks = new Set<string>();
      for (const r of existingRows ?? []) {
        const v = normVin(r.vin ?? '');
        const s = normStock(r.stock_number ?? '');
        if (v) dbVins.add(v);
        if (s) dbStocks.add(s);
      }

      setImportStatus('Filtering duplicates...');

      const cleanRows: any[] = [];
      for (const r of toInsert) {
        const nv: string | null = r.__nVin;
        const ns: string | null = r.__nStock;

        // VIN match — highest priority
        if (nv && dbVins.has(nv)) {
          existingDupes++;
          dupesDetail.push({ row: 0, name: r.__name, vin: r.__vinRaw, stock: r.__stockRaw, reason: 'Already in database', matchedOn: 'VIN' });
          continue;
        }
        // Stock# match — checked independently (not gated on missing VIN)
        if (ns && dbStocks.has(ns)) {
          existingDupes++;
          dupesDetail.push({ row: 0, name: r.__name, vin: r.__vinRaw, stock: r.__stockRaw, reason: 'Already in database', matchedOn: 'Stock#' });
          continue;
        }

        cleanRows.push(r);
      }

      // Strip internal metadata before inserting
      const dbRows = cleanRows.map(({ __nVin, __nStock, __name, __vinRaw, __stockRaw, ...rest }) => rest);

      // ── Step 4: Insert clean rows in chunks ────────────────────────────────
      let inserted = 0;
      const CHUNK = 25;

      for (let i = 0; i < dbRows.length; i += CHUNK) {
        const slice = dbRows.slice(i, i + CHUNK);
        setImportStatus(`Inserting sales ${Math.min(i + CHUNK, dbRows.length)} of ${dbRows.length}...`);
        const { error: insErr } = await withTimeout(
          supabase.from('sales').insert(slice),
          `Sales insert starting at row ${i + 1}`,
        );
        if (insErr) {
          console.error(`[SalesUpload] insert chunk ${i}-${i + slice.length} failed:`, insErr, 'sample row:', slice[0]);
          throw new Error(
            `DB rejected sales insert (chunk starting row ${i + 1}): ${insErr.message}` +
            `${insErr.details ? ' — ' + insErr.details : ''}` +
            `${insErr.hint ? ' — ' + insErr.hint : ''}`,
          );
        }
        inserted += slice.length;
      }

      // ── Step 5: Update upload record with final counts ─────────────────────
      setImportStatus('Finalizing import...');
      const totalDupes = dupesInBatch + existingDupes;
      const { error: updateErr } = await withTimeout(
        supabase.from('raw_sales_uploads').update({
          inserted_count:  inserted,
          duplicate_count: totalDupes,
        }).eq('id', upload.id),
        'Finalizing upload record',
      );
      if (updateErr) console.warn('[SalesUpload] upload summary update failed:', updateErr);

      setResult({ inserted, duplicates: totalDupes, skippedRows: dupesDetail, uploadId: upload.id });
      toast.success(`Imported ${inserted} sales · ${totalDupes} duplicates skipped`);

    } catch (e: any) {
      const msg = e?.message ?? 'Import failed';
      console.error('[SalesUpload] import failed:', e);
      setImportError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
      setImportStatus(null);
    }
  };

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload Sales (CSV)</h1>
        <p className="text-sm text-muted-foreground">
          For {activeOrg?.name}. Import CRM/DMS sales — duplicates skipped automatically.
        </p>
      </div>

      {/* ── Step 1: File picker ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose file</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Label>CSV file</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={e => onFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <>
          {/* ── Step 2: Column mapper ──────────────────────────────────────── */}
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

          {/* ── Step 3: Preview ────────────────────────────────────────────── */}
          <Card>
            <CardHeader><CardTitle className="text-base">3. Preview (first 5 rows)</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    {headers.map(h => (
                      <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b">
                      {headers.map(h => (
                        <td key={h} className="px-2 py-1 text-muted-foreground">{r[h]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* ── Error / status alerts ──────────────────────────────────────── */}
          {importError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Import failed</AlertTitle>
              <AlertDescription className="break-words text-xs font-mono mt-2">
                {importError}
              </AlertDescription>
            </Alert>
          )}

          {importStatus && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Import in progress</AlertTitle>
              <AlertDescription className="text-xs mt-2">{importStatus}</AlertDescription>
            </Alert>
          )}

          {rowSkips.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{rowSkips.length} row(s) skipped — no identifying info</AlertTitle>
              <AlertDescription className="text-xs mt-2 max-h-40 overflow-y-auto">
                <ul className="space-y-0.5">
                  {rowSkips.slice(0, 20).map(s => (
                    <li key={s.row}>Row {s.row}: {s.reason}</li>
                  ))}
                  {rowSkips.length > 20 && (
                    <li>…and {rowSkips.length - 20} more (see browser console)</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Result summary + skipped-dupes detail ─────────────────────── */}
          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Import complete</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Counts row */}
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="rounded-md border bg-muted px-3 py-1.5 font-medium">
                    📥 {rows.length} rows parsed
                  </span>
                  <span className="rounded-md border border-green-200 bg-green-50 px-3 py-1.5 font-medium text-green-800">
                    ✅ {result.inserted} inserted
                  </span>
                  <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 font-medium text-amber-800">
                    ⚠️ {result.duplicates} duplicates skipped
                  </span>
                </div>

                {/* Skipped-dupes detail table */}
                {result.skippedRows.length > 0 && (
                  <div>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowSkipped(v => !v)}
                    >
                      {showSkipped ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {showSkipped ? 'Hide' : 'Show'} {result.skippedRows.length} skipped duplicate{result.skippedRows.length !== 1 ? 's' : ''}
                    </button>

                    {showSkipped && (
                      <div className="mt-2 max-h-64 overflow-y-auto rounded border">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-muted">
                            <tr>
                              <th className="px-2 py-1 text-left">Name</th>
                              <th className="px-2 py-1 text-left">VIN</th>
                              <th className="px-2 py-1 text-left">Stock #</th>
                              <th className="px-2 py-1 text-left">Reason</th>
                              <th className="px-2 py-1 text-left">Matched on</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.skippedRows.map((s, i) => (
                              <tr key={i} className="border-t">
                                <td className="px-2 py-1">{s.name || '—'}</td>
                                <td className="px-2 py-1 font-mono">{s.vin || '—'}</td>
                                <td className="px-2 py-1">{s.stock || '—'}</td>
                                <td className="px-2 py-1 text-amber-700">{s.reason}</td>
                                <td className="px-2 py-1 text-muted-foreground">{s.matchedOn}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Import button ──────────────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-3">
            <Button onClick={ingest} disabled={busy}>
              <UploadIcon className="mr-1 h-4 w-4" />
              {busy ? 'Importing...' : `Import ${rows.length} rows`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
