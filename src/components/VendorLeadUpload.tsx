import { useState, useRef, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, FileUp, CheckCircle2, AlertTriangle, X, Car } from 'lucide-react';
import { VendorLead } from '@/types/models';

type Step = 'vendor' | 'upload' | 'mapping' | 'preview' | 'result';

type FieldKey = 'vin' | 'year' | 'make' | 'model' | 'trim' | 'body_style' | 'dol' | 'last_price' | 'lotlinx_vdp' | 'total_vdp' | 'net_new_shoppers' | 'pct_sales_opportunities';

type MappingConfig = Record<FieldKey, string>;

const FIELDS: { key: FieldKey; label: string; required: boolean }[] = [
  { key: 'vin', label: 'VIN', required: true },
  { key: 'year', label: 'Year', required: true },
  { key: 'make', label: 'Make', required: true },
  { key: 'model', label: 'Model', required: true },
  { key: 'trim', label: 'Trim', required: false },
  { key: 'body_style', label: 'Body Style', required: false },
  { key: 'dol', label: 'DOL', required: false },
  { key: 'last_price', label: 'Last Price', required: false },
  { key: 'lotlinx_vdp', label: 'Lotlinx VDP', required: false },
  { key: 'total_vdp', label: 'Total VDP', required: false },
  { key: 'net_new_shoppers', label: 'Net New Shoppers', required: false },
  { key: 'pct_sales_opportunities', label: '% Sales Opportunities', required: false },
];

const EMPTY_MAPPING: MappingConfig = {
  vin: '', year: '', make: '', model: '', trim: '', body_style: '',
  dol: '', last_price: '', lotlinx_vdp: '', total_vdp: '',
  net_new_shoppers: '', pct_sales_opportunities: '',
};

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

function guessMapping(headers: string[]): MappingConfig {
  const mapping = { ...EMPTY_MAPPING };
  const lower = headers.map(h => h.toLowerCase().replace(/[^a-z0-9%]/g, ''));

  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (!mapping.vin && h.includes('vin')) mapping.vin = headers[i];
    else if (!mapping.year && h === 'year') mapping.year = headers[i];
    else if (!mapping.make && h === 'make') mapping.make = headers[i];
    else if (!mapping.model && h === 'model') mapping.model = headers[i];
    else if (!mapping.trim && h === 'trim') mapping.trim = headers[i];
    else if (!mapping.body_style && (h.includes('body') || h.includes('style'))) mapping.body_style = headers[i];
    else if (!mapping.dol && h === 'dol') mapping.dol = headers[i];
    else if (!mapping.last_price && (h.includes('lastprice') || h.includes('price'))) mapping.last_price = headers[i];
    else if (!mapping.lotlinx_vdp && h.includes('lotlinx')) mapping.lotlinx_vdp = headers[i];
    else if (!mapping.total_vdp && h.includes('totalvdp')) mapping.total_vdp = headers[i];
    else if (!mapping.net_new_shoppers && (h.includes('netnew') || h.includes('shopper'))) mapping.net_new_shoppers = headers[i];
    else if (!mapping.pct_sales_opportunities && (h.includes('%sales') || h.includes('salesopp') || h.includes('opportunity'))) mapping.pct_sales_opportunities = headers[i];
  }
  return mapping;
}

function parseNum(val: string): number {
  const cleaned = val.replace(/[$,%\s]/g, '');
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

export default function VendorLeadUpload() {
  const { vendors, vendorLeads, addVendorLeads } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('vendor');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<MappingConfig>({ ...EMPTY_MAPPING });
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [fileError, setFileError] = useState('');

  const reset = () => {
    setStep('vendor');
    setSelectedVendorId('');
    setHeaders([]);
    setRows([]);
    setMapping({ ...EMPTY_MAPPING });
    setResult(null);
    setFileError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) { setFileError('Only .csv files accepted.'); return; }
    if (file.size > 10 * 1024 * 1024) { setFileError('File exceeds 10MB.'); return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { setFileError('CSV needs header + data rows.'); return; }
      const h = parseCSVLine(lines[0]);
      setHeaders(h);
      setRows(lines.slice(1).map(l => parseCSVLine(l)));
      setMapping(guessMapping(h));
      setStep('mapping');
    };
    reader.readAsText(file);
  }, []);

  const isMappingValid = () => mapping.vin && mapping.year && mapping.make && mapping.model;

  const handleImport = () => {
    const errors: string[] = [];
    const valid: Omit<VendorLead, 'id'>[] = [];
    const colIdx = (col: string) => headers.indexOf(col);

    rows.forEach((row, i) => {
      const vin = mapping.vin ? (row[colIdx(mapping.vin)] || '').trim() : '';
      const year = mapping.year ? (row[colIdx(mapping.year)] || '').trim() : '';
      const make = mapping.make ? (row[colIdx(mapping.make)] || '').trim() : '';
      const model = mapping.model ? (row[colIdx(mapping.model)] || '').trim() : '';

      if (!vin || !year || !make || !model) { errors.push(`Row ${i + 2}: Missing required field (VIN/Year/Make/Model)`); return; }

      valid.push({
        vendor_id: selectedVendorId,
        vin,
        year,
        make,
        model,
        trim: mapping.trim ? (row[colIdx(mapping.trim)] || '').trim() : '',
        body_style: mapping.body_style ? (row[colIdx(mapping.body_style)] || '').trim() : '',
        dol: mapping.dol ? parseNum(row[colIdx(mapping.dol)] || '') : 0,
        last_price: mapping.last_price ? parseNum(row[colIdx(mapping.last_price)] || '') : 0,
        lotlinx_vdp: mapping.lotlinx_vdp ? parseNum(row[colIdx(mapping.lotlinx_vdp)] || '') : 0,
        total_vdp: mapping.total_vdp ? parseNum(row[colIdx(mapping.total_vdp)] || '') : 0,
        net_new_shoppers: mapping.net_new_shoppers ? parseNum(row[colIdx(mapping.net_new_shoppers)] || '') : 0,
        pct_sales_opportunities: mapping.pct_sales_opportunities ? parseNum(row[colIdx(mapping.pct_sales_opportunities)] || '') : 0,
        uploaded_at: new Date().toISOString(),
      });
    });

    if (valid.length > 0) addVendorLeads(valid);
    setResult({ imported: valid.length, skipped: errors.length, errors });
    setStep('result');
  };

  const selectedVendor = vendors.find(v => v.id === selectedVendorId);
  const vendorLeadsFiltered = vendorLeads.filter(vl => !selectedVendorId || vl.vendor_id === selectedVendorId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Vendor Lead Upload</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Car className="h-5 w-5" />Upload Vendor Leads</CardTitle>
            {step !== 'vendor' && <Button variant="ghost" size="sm" onClick={reset}><X className="mr-1 h-4 w-4" />Reset</Button>}
          </div>
        </CardHeader>
        <CardContent>
          {step === 'vendor' && (
            <div className="space-y-4">
              <div>
                <Label>Select Vendor</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedVendorId}
                  onChange={e => setSelectedVendorId(e.target.value)}
                >
                  <option value="">— Choose a vendor —</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <Button disabled={!selectedVendorId} onClick={() => setStep('upload')}>
                Continue to Upload
              </Button>
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Uploading leads for: <strong>{selectedVendor?.name}</strong>
              </p>
              <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-8 text-center">
                <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
                <p className="mb-1 text-sm font-medium text-foreground">Upload Vendor Lead CSV</p>
                <p className="mb-4 text-xs text-muted-foreground">Expected columns: VIN, Year, Make, Model, Trim, Body Style, DOL, Last Price, etc.</p>
                <Input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="max-w-xs" />
              </div>
              {fileError && <p className="text-sm text-destructive flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{fileError}</p>}
            </div>
          )}

          {step === 'mapping' && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">Uploading for: <strong>{selectedVendor?.name}</strong></p>
              <div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">Map your columns</h3>
                <p className="text-xs text-muted-foreground">VIN, Year, Make, and Model are required.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map(field => (
                  <div key={field.key}>
                    <Label className="flex items-center gap-1">
                      {field.label}
                      {field.required && <span className="text-destructive">*</span>}
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
                  <AlertTriangle className="h-4 w-4" />Map VIN, Year, Make, and Model to continue.
                </p>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">Preview ({Math.min(5, rows.length)} of {rows.length} rows)</h3>
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
                      {rows.slice(0, 5).map((row, i) => (
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
              <h3 className="text-sm font-semibold text-foreground">Confirm Import</h3>
              <div className="rounded-lg border border-border p-4 space-y-2">
                <p className="text-sm">Vendor: <strong>{selectedVendor?.name}</strong></p>
                <p className="text-sm"><strong>{rows.length}</strong> rows will be processed</p>
                <p className="text-xs text-muted-foreground mt-2">Rows missing VIN/Year/Make/Model will be skipped.</p>
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
                <CheckCircle2 className="mt-0.5 h-6 w-6 text-primary" />
                <div>
                  <h3 className="font-semibold text-foreground">Import Complete</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="text-primary font-medium">{result.imported} rows imported</span>
                    {result.skipped > 0 && <span className="text-destructive ml-2">· {result.skipped} skipped</span>}
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

      {/* Display uploaded leads */}
      <Card>
        <CardHeader>
          <CardTitle>Uploaded Leads ({vendorLeadsFiltered.length})</CardTitle>
          {vendors.length > 0 && (
            <div className="mt-2">
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedVendorId}
                onChange={e => setSelectedVendorId(e.target.value)}
              >
                <option value="">All Vendors</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>VIN</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Make</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Trim</TableHead>
                  <TableHead>Body Style</TableHead>
                  <TableHead>DOL</TableHead>
                  <TableHead>Last Price</TableHead>
                  <TableHead>Lotlinx VDP</TableHead>
                  <TableHead>Total VDP</TableHead>
                  <TableHead>Net New Shoppers</TableHead>
                  <TableHead>% Sales Opp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorLeadsFiltered.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No leads uploaded yet.</TableCell></TableRow>
                ) : (
                  vendorLeadsFiltered.slice().reverse().slice(0, 50).map(vl => (
                    <TableRow key={vl.id}>
                      <TableCell>{vendors.find(v => v.id === vl.vendor_id)?.name || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{vl.vin}</TableCell>
                      <TableCell>{vl.year}</TableCell>
                      <TableCell>{vl.make}</TableCell>
                      <TableCell>{vl.model}</TableCell>
                      <TableCell>{vl.trim}</TableCell>
                      <TableCell>{vl.body_style}</TableCell>
                      <TableCell>{vl.dol}</TableCell>
                      <TableCell>${vl.last_price.toLocaleString()}</TableCell>
                      <TableCell>{vl.lotlinx_vdp}</TableCell>
                      <TableCell>{vl.total_vdp}</TableCell>
                      <TableCell>{vl.net_new_shoppers}</TableCell>
                      <TableCell>{vl.pct_sales_opportunities}%</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
