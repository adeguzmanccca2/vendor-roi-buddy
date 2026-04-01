import { useState, useRef, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, FileUp, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { Sale } from '@/types/models';

type Step = 'upload' | 'mapping' | 'preview' | 'result';
type FieldKey = 'name' | 'phone' | 'email' | 'revenue' | 'close_date';

interface MappingConfig {
  name: string;
  phone: string;
  email: string;
  revenue: string;
  close_date: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

const REQUIRED_FIELDS: { key: FieldKey; label: string; required: boolean }[] = [
  { key: 'phone', label: 'Phone', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'revenue', label: 'Revenue', required: true },
  { key: 'close_date', label: 'Close Date', required: true },
  { key: 'name', label: 'Customer Name', required: false },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizePhone(p: string): string {
  return p.replace(/[\s\-().+]/g, '').replace(/^1(\d{10})$/, '$1');
}

function parseDate(val: string): string | null {
  if (!val) return null;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString();
  // Try MM/DD/YYYY
  const parts = val.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (parts) {
    const year = parts[3].length === 2 ? '20' + parts[3] : parts[3];
    const d2 = new Date(`${year}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`);
    if (!isNaN(d2.getTime())) return d2.toISOString();
  }
  return null;
}

function parseRevenue(val: string): number | null {
  const cleaned = val.replace(/[$,\s]/g, '');
  const num = Number(cleaned);
  return isNaN(num) || num < 0 ? null : num;
}

function guessMapping(headers: string[]): MappingConfig {
  const mapping: MappingConfig = { name: '', phone: '', email: '', revenue: '', close_date: '' };
  const lower = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (!mapping.phone && (h.includes('phone') || h.includes('contact') || h.includes('mobile') || h.includes('cell'))) mapping.phone = headers[i];
    else if (!mapping.email && (h.includes('email') || h.includes('mail'))) mapping.email = headers[i];
    else if (!mapping.revenue && (h.includes('revenue') || h.includes('price') || h.includes('value') || h.includes('amount') || h.includes('deal') || h.includes('sale'))) mapping.revenue = headers[i];
    else if (!mapping.close_date && (h.includes('date') || h.includes('closed') || h.includes('sold'))) mapping.close_date = headers[i];
    else if (!mapping.name && (h.includes('name') || h.includes('customer') || h.includes('buyer'))) mapping.name = headers[i];
  }
  return mapping;
}

export default function CsvUploadModule() {
  const { addSales } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<MappingConfig>({ name: '', phone: '', email: '', revenue: '', close_date: '' });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState('');

  const reset = () => {
    setStep('upload');
    setHeaders([]);
    setRows([]);
    setMapping({ name: '', phone: '', email: '', revenue: '', close_date: '' });
    setResult(null);
    setFileError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('Only .csv files are accepted.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError('File exceeds 10MB limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { setFileError('CSV must have a header row and at least one data row.'); return; }

      const parsedHeaders = parseCSVLine(lines[0]);
      const parsedRows = lines.slice(1).map(l => parseCSVLine(l));

      setHeaders(parsedHeaders);
      setRows(parsedRows);
      setMapping(guessMapping(parsedHeaders));
      setStep('mapping');
    };
    reader.readAsText(file);
  }, []);

  const isMappingValid = () => {
    return (mapping.phone || mapping.email) && mapping.revenue && mapping.close_date;
  };

  const handleImport = () => {
    const errors: string[] = [];
    const valid: Omit<Sale, 'id'>[] = [];

    const colIdx = (col: string) => headers.indexOf(col);

    rows.forEach((row, rowNum) => {
      const phoneIdx = mapping.phone ? colIdx(mapping.phone) : -1;
      const emailIdx = mapping.email ? colIdx(mapping.email) : -1;
      const revenueIdx = colIdx(mapping.revenue);
      const dateIdx = colIdx(mapping.close_date);
      const nameIdx = mapping.name ? colIdx(mapping.name) : -1;

      const phone = phoneIdx >= 0 ? normalizePhone(row[phoneIdx] || '') : '';
      const email = emailIdx >= 0 ? (row[emailIdx] || '').trim().toLowerCase() : '';
      const revenueRaw = row[revenueIdx] || '';
      const dateRaw = row[dateIdx] || '';
      const name = nameIdx >= 0 ? (row[nameIdx] || '').trim() : '';

      if (!phone && !email) { errors.push(`Row ${rowNum + 2}: Missing both phone and email`); return; }

      const revenue = parseRevenue(revenueRaw);
      if (revenue === null) { errors.push(`Row ${rowNum + 2}: Invalid revenue "${revenueRaw}"`); return; }

      const closeDate = parseDate(dateRaw);
      if (!closeDate) { errors.push(`Row ${rowNum + 2}: Invalid date "${dateRaw}"`); return; }

      valid.push({ name, phone, email, revenue, close_date: closeDate });
    });

    if (valid.length > 0) addSales(valid);

    setResult({ imported: valid.length, skipped: errors.length, errors });
    setStep('result');
  };

  const previewRows = rows.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><FileUp className="h-5 w-5" />CRM CSV Import</CardTitle>
          {step !== 'upload' && <Button variant="ghost" size="sm" onClick={reset}><X className="mr-1 h-4 w-4" />Reset</Button>}
        </div>
      </CardHeader>
      <CardContent>
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-8 text-center">
              <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="mb-1 text-sm font-medium text-foreground">Upload CRM Export</p>
              <p className="mb-4 text-xs text-muted-foreground">CSV file, max 10MB. Supports any column format.</p>
              <Input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="max-w-xs" />
            </div>
            {fileError && <p className="text-sm text-destructive flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{fileError}</p>}
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-foreground">Step 1: Map your columns</h3>
              <p className="text-xs text-muted-foreground">Select which CSV column corresponds to each field. Phone or Email is required.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {REQUIRED_FIELDS.map(field => (
                <div key={field.key}>
                  <Label className="flex items-center gap-1">
                    {field.label}
                    {field.required && <span className="text-destructive">*</span>}
                    {field.key === 'phone' && <span className="text-xs text-muted-foreground">(or Email required)</span>}
                  </Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={mapping[field.key]}
                    onChange={e => setMapping({ ...mapping, [field.key]: e.target.value })}
                  >
                    <option value="">— Skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {!isMappingValid() && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                Map at least Phone or Email, plus Revenue and Close Date.
              </p>
            )}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Preview ({Math.min(8, rows.length)} of {rows.length} rows)</h3>
              <div className="overflow-x-auto rounded border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map(h => {
                        const mapped = Object.entries(mapping).find(([, v]) => v === h);
                        return (
                          <TableHead key={h} className="whitespace-nowrap">
                            {h}
                            {mapped && mapped[1] && <Badge variant="secondary" className="ml-1 text-xs">{mapped[0]}</Badge>}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((cell, j) => <TableCell key={j} className="whitespace-nowrap text-xs">{cell}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <Button onClick={() => setStep('preview')} disabled={!isMappingValid()}>Continue to Confirm</Button>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Step 2: Confirm Import</h3>
            <div className="rounded-lg border border-border p-4 space-y-2">
              <p className="text-sm"><strong>{rows.length}</strong> rows will be processed</p>
              <p className="text-sm text-muted-foreground">Mapping:</p>
              <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
                {mapping.phone && <li>Phone → <strong>{mapping.phone}</strong></li>}
                {mapping.email && <li>Email → <strong>{mapping.email}</strong></li>}
                <li>Revenue → <strong>{mapping.revenue}</strong></li>
                <li>Close Date → <strong>{mapping.close_date}</strong></li>
                {mapping.name && <li>Name → <strong>{mapping.name}</strong></li>}
              </ul>
              <p className="text-xs text-muted-foreground mt-2">Invalid rows will be skipped automatically.</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleImport}>Import {rows.length} Rows</Button>
              <Button variant="outline" onClick={() => setStep('mapping')}>Back</Button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-border p-4">
              <CheckCircle2 className="mt-0.5 h-6 w-6 text-success" />
              <div>
                <h3 className="font-semibold text-foreground">Import Complete</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="text-success font-medium">{result.imported} rows imported</span>
                  {result.skipped > 0 && <span className="text-destructive ml-2">· {result.skipped} rows skipped</span>}
                </p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded border border-destructive/20 bg-destructive/5 p-3">
                <p className="mb-2 text-xs font-medium text-destructive">Errors:</p>
                {result.errors.map((err, i) => <p key={i} className="text-xs text-destructive/80">{err}</p>)}
              </div>
            )}

            <Button onClick={reset}>Upload Another File</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
