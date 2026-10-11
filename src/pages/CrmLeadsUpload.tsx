import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, ChevronDown, ChevronUp, Download, FileSpreadsheet, Search, Upload as UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { downloadCsv } from '@/lib/exportCsv';
import {
  CRM_FIELDS,
  crmRowsFromFile,
  executeCrmPlan,
  existingLeadWindow,
  fetchExistingLeads,
  fetchSourceRules,
  fetchSavedCrmMapping,
  resolveCrmMapping,
  saveCrmMapping,
  planCrmImport,
  type CrmFieldKey,
  type CrmImportResult,
  type CrmMapping,
  type CrmPlan,
} from '@/lib/crmLeads';

// CRM Leads Upload -- deliberately separate from the vendor lead upload
// (Upload.tsx) so that page's one-vendor-per-file flow is untouched. Here the
// vendor comes from each row's Lead Provider (Source Rules), CRM rows that
// are already a vendor lead fill that lead's blanks instead of duplicating
// it, and the rest are added as new leads marked lead_origin = 'crm'. The
// matching rules live in src/lib/crmLeads.ts, shared with the email import.

const NONE = '__none__';

const SKIP_REASON_LABEL: Record<string, string> = {
  'skip-rule': 'Skip rule (e.g. Service)',
  'no-identifier': 'No name, phone, email, VIN or stock #',
  'duplicate-in-file': 'Same person listed again in this file',
};

async function readRows(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { headers: [], rows: [] };
    // raw: false + dateNF gives date cells as plain yyyy-mm-dd text.
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
    const headers = (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? [])
      .map(h => String(h ?? '').trim()).filter(Boolean);
    return { headers, rows };
  }
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: res => resolve({ headers: (res.meta.fields ?? []).filter(h => h.trim() !== ''), rows: res.data }),
      error: err => reject(err),
    });
  });
}

export default function CrmLeadsUploadPage() {
  const { user } = useAuth();
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<CrmMapping>({});
  // Columns came from this dealership's saved mapping (vs. built-in guesses).
  const [fromSaved, setFromSaved] = useState(false);
  // Save the columns after import so emailed CRM files use them too.
  const [saveColumns, setSaveColumns] = useState(true);
  const [vendorNames, setVendorNames] = useState<Map<string, string>>(new Map());
  const [ruleCount, setRuleCount] = useState<number | null>(null);
  const [plan, setPlan] = useState<CrmPlan | null>(null);
  const [busy, setBusy] = useState<'checking' | 'importing' | null>(null);
  const [result, setResult] = useState<CrmImportResult | null>(null);
  const [credited, setCredited] = useState<number | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const reset = () => { setPlan(null); setResult(null); setCredited(null); setShowSkipped(false); };

  const onFile = async (f: File | null) => {
    setFile(f);
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setFromSaved(false);
    reset();
    if (!f) return;
    try {
      const { headers: h, rows } = await readRows(f);
      setHeaders(h);
      setRawRows(rows);
      const saved = activeOrgId ? await fetchSavedCrmMapping(supabase, activeOrgId) : null;
      const resolved = resolveCrmMapping(h, saved);
      setMapping(resolved.mapping);
      setFromSaved(resolved.fromSaved);
      toast.success(`Parsed ${rows.length} rows`);
    } catch (e) {
      toast.error('Could not read file: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const setField = (key: CrmFieldKey, col: string) => {
    setMapping(prev => ({ ...prev, [key]: col === NONE ? undefined : col }));
    setFromSaved(false);
    reset();
  };

  const crmRows = useMemo(() => crmRowsFromFile(rawRows, mapping), [rawRows, mapping]);

  const check = async () => {
    if (!activeOrgId) return;
    if (!mapping.provider) return toast.error('Map the Lead Provider column first');
    setBusy('checking');
    reset();
    try {
      const [rules, existing, vendorsRes] = await Promise.all([
        fetchSourceRules(supabase, activeOrgId),
        fetchExistingLeads(supabase, activeOrgId, crmRows),
        supabase.from('vendors').select('id, name').eq('organization_id', activeOrgId),
      ]);
      if (vendorsRes.error) throw new Error(vendorsRes.error.message);
      setVendorNames(new Map((vendorsRes.data ?? []).map(v => [v.id, v.name])));
      setRuleCount(rules.length);
      setPlan(planCrmImport(crmRows, existing, rules));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!activeOrgId || !user || !file || !plan) return;
    setBusy('importing');
    try {
      const { data: upload, error: upErr } = await supabase
        .from('raw_lead_uploads')
        .insert({
          organization_id: activeOrgId,
          vendor_id: null,
          uploaded_by: user.id,
          filename: file.name,
          row_count: rawRows.length,
          column_mapping: { ...mapping, kind: 'crm' },
          // Excel rows are plain strings (raw: false), so this is JSON-safe.
          raw_rows: rawRows.slice(0, 1000) as unknown as Json,
        })
        .select('id')
        .single();
      if (upErr || !upload) throw upErr ?? new Error('Upload record failed');

      const res = await executeCrmPlan(supabase, activeOrgId, plan, { rawUploadId: upload.id });
      await supabase.from('raw_lead_uploads')
        .update({ inserted_count: res.inserted, duplicate_count: res.alreadyImported + res.matched })
        .eq('id', upload.id);

      // New leads can match sales that were unattributed until now. Same
      // matcher every import path uses; idempotent.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: creditCount, error: attrErr } = await (supabase.rpc as any)('attribute_sale_credits_for_org', { _org_id: activeOrgId });
      if (attrErr) toast.warning('Leads imported, but sales matching failed — re-run it from Attribution → Dry run.');
      else setCredited(Number(creditCount ?? 0));

      if (saveColumns) {
        const saveErr = await saveCrmMapping(supabase, activeOrgId, mapping, user.id);
        if (saveErr) toast.warning('Leads imported, but saving the column mapping failed: ' + saveErr);
        else setFromSaved(true);
      }

      setResult(res);
      setPlan(null);
      if (res.errors.length > 0) toast.warning(`Imported with ${res.errors.length} error(s)`);
      else toast.success(`Added ${res.inserted} new lead(s) · ${res.matched} matched existing leads`);
    } catch (e) {
      toast.error('Import failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  const destination = (r: CrmPlan['byProvider'] extends Map<string, infer V> ? V : never) =>
    r.resolution.kind === 'vendor'
      ? (vendorNames.get(r.resolution.vendorId) ?? 'Unknown vendor')
      : r.resolution.kind === 'skip' ? 'Skip' : 'Unassigned';

  // One line per skipped file row, for the list and the CSV download.
  const skippedRows = useMemo(() => (plan?.skips ?? [])
    .map(s => ({
      row: s.row.rowNumber,
      name: s.row.fullName ?? ([s.row.firstName, s.row.lastName].filter(Boolean).join(' ') || ''),
      phone: s.row.phone ?? '',
      email: s.row.email ?? '',
      lead_provider: s.row.provider ?? '',
      lead_date: s.row.leadDate ? s.row.leadDate.slice(0, 10) : '',
      reason: SKIP_REASON_LABEL[s.reason] ?? s.reason,
      detail: s.mergedIntoRow ? `Merged into row ${s.mergedIntoRow}` : '',
    }))
    .sort((a, b) => a.row - b.row), [plan]);

  const skipCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of plan?.skips ?? []) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
    return m;
  }, [plan]);

  const datedRows = crmRows.filter(r => r.leadDate).length;
  const matchRange = useMemo(() => {
    const w = existingLeadWindow(crmRows);
    if (!w) return null;
    // UTC calendar days -- see existingLeadWindow.
    const fmt = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `${fmt(w.from)} – ${fmt(w.to)}`;
  }, [crmRows]);

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload CRM Leads</h1>
        <p className="text-sm text-muted-foreground">
          For {activeOrg?.name}. Each row's vendor comes from its Lead Provider (see{' '}
          <Link to="/source-rules" className="underline">Source Rules</Link>). A CRM lead that is already a vendor lead
          (same email, phone, VIN or stock #, with the vendor lead dated inside this file's date range) fills that lead's blanks instead of being added twice.
          Your vendor lead upload is not affected.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose file</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Label>CRM export (CSV or Excel)</Label>
            <Input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={e => onFile(e.target.files?.[0] ?? null)} />
          </div>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" /> 2. Map columns
              <Badge variant="secondary" className="ml-2">{rawRows.length} rows</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              {CRM_FIELDS.map(f => (
                <div key={f.key} className="grid gap-1">
                  <Label className="text-xs">{f.label}{f.required && ' *'}</Label>
                  <Select value={mapping[f.key] ?? NONE} onValueChange={v => setField(f.key, v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Skip —</SelectItem>
                      {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {mapping.lead_date && datedRows < crmRows.length && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {crmRows.length - datedRows} row(s) have no readable lead date. They can still match an existing lead
                dated inside the file's date range, and are imported without a date.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {fromSaved
                ? 'Columns loaded from the mapping saved for this dealership.'
                : 'Columns guessed from the header names — check them before continuing.'}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={saveColumns} onCheckedChange={v => setSaveColumns(v === true)} />
              Save these columns for this dealership (used for emailed CRM files)
            </label>
            <Button onClick={check} disabled={busy !== null || !mapping.provider}>
              <Search className="mr-1 h-4 w-4" /> {busy === 'checking' ? 'Checking…' : 'Check against existing leads'}
            </Button>
          </CardContent>
        </Card>
      )}

      {plan && (
        <Card>
          <CardHeader><CardTitle className="text-base">3. Review</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {ruleCount === 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>No Source Rules for this dealership</AlertTitle>
                <AlertDescription className="text-xs">
                  Every row would import as Unassigned. Add Lead Provider rules on the{' '}
                  <Link to="/source-rules" className="underline">Source Rules</Link> page first.
                </AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground">
              {matchRange
                ? `Compared with existing leads dated ${matchRange} (this file's date range).`
                : 'No row has a lead date, so every existing lead was compared.'}
            </p>

            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-md border border-green-200 bg-green-50 px-3 py-1.5 font-medium text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                ➕ {plan.inserts.length} new leads (CRM only)
              </span>
              <span className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                🔗 {plan.enrichments.length} already a lead
                {' '}({plan.enrichments.filter(e => Object.keys(e.patch).length > 0).length} get blanks filled)
              </span>
              <span className="rounded-md border bg-muted px-3 py-1.5 font-medium">
                ⏭ {plan.skips.length} skipped
              </span>
            </div>

            {plan.skips.length > 0 && (
              <div className="space-y-2">
                <ul className="text-xs text-muted-foreground">
                  {[...skipCounts.entries()].map(([reason, count]) => (
                    <li key={reason}>{count} · {SKIP_REASON_LABEL[reason] ?? reason}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowSkipped(v => !v)}>
                    {showSkipped ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
                    {showSkipped ? 'Hide' : 'Show'} {plan.skips.length} skipped row{plan.skips.length === 1 ? '' : 's'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadCsv(`crm-skipped-${(file?.name ?? 'file').replace(/\.[^.]+$/, '')}.csv`, skippedRows)}
                  >
                    <Download className="mr-1 h-4 w-4" /> Download skipped (CSV)
                  </Button>
                </div>
                {showSkipped && (
                  <div className="max-h-80 overflow-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 border-b bg-background text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 text-right">Row</th>
                          <th className="px-2 py-1 text-left">Name</th>
                          <th className="px-2 py-1 text-left">Phone</th>
                          <th className="px-2 py-1 text-left">Email</th>
                          <th className="px-2 py-1 text-left">Lead Provider</th>
                          <th className="px-2 py-1 text-left">Lead date</th>
                          <th className="px-2 py-1 text-left">Why skipped</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skippedRows.map(r => (
                          <tr key={r.row} className="border-b">
                            <td className="px-2 py-1 text-right tabular-nums">{r.row}</td>
                            <td className="px-2 py-1">{r.name || '—'}</td>
                            <td className="px-2 py-1">{r.phone || '—'}</td>
                            <td className="px-2 py-1">{r.email || '—'}</td>
                            <td className="px-2 py-1">{r.lead_provider || '—'}</td>
                            <td className="px-2 py-1">{r.lead_date || '—'}</td>
                            <td className="px-2 py-1">{r.reason}{r.detail && ` · ${r.detail}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {plan.unmappedProviders.size > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{plan.unmappedProviders.size} Lead Provider value(s) have no rule — imported as Unassigned</AlertTitle>
                <AlertDescription className="text-xs">
                  {[...plan.unmappedProviders.entries()].map(([p, c]) => `${p} (${c})`).join(' · ')}
                  <br />Add a rule on <Link to="/source-rules" className="underline">Source Rules</Link> and check again
                  to tag them, or import now and use "Apply rules" there later.
                </AlertDescription>
              </Alert>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Lead Provider</th>
                    <th className="px-2 py-2 text-left">Vendor</th>
                    <th className="px-2 py-2 text-right">Rows</th>
                    <th className="px-2 py-2 text-right">New</th>
                    <th className="px-2 py-2 text-right">Already a lead</th>
                    <th className="px-2 py-2 text-right">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {[...plan.byProvider.entries()].sort((a, b) => b[1].rows - a[1].rows).map(([provider, r]) => (
                    <tr key={provider} className="border-b">
                      <td className="px-2 py-1.5">{provider}</td>
                      <td className="px-2 py-1.5">
                        {r.resolution.kind === 'vendor'
                          ? destination(r)
                          : <Badge variant="outline">{destination(r)}</Badge>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.rows}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.inserts}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.matched}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button onClick={runImport} disabled={busy !== null || (plan.inserts.length === 0 && plan.enrichments.length === 0)}>
              <UploadIcon className="mr-1 h-4 w-4" />
              {busy === 'importing' ? 'Importing…' : `Import ${plan.inserts.length} new · update ${plan.enrichments.length}`}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader><CardTitle className="text-base">Import complete</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>✅ {result.inserted} new lead(s) added
              {result.alreadyImported > 0 && ` · ${result.alreadyImported} were already imported from an earlier CRM file`}</p>
            <p>🔗 {result.matched} matched existing leads · {result.enriched} had blank fields filled</p>
            {credited != null && <p>💰 {credited} new vendor credit(s) on sales</p>}
            {result.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{result.errors.length} error(s)</AlertTitle>
                <AlertDescription className="text-xs">
                  <ul>{result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>
                </AlertDescription>
              </Alert>
            )}
            <Button variant="outline" asChild><Link to="/leads">View Leads →</Link></Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
