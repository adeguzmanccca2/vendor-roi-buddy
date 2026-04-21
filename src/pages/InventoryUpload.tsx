import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Upload as UploadIcon } from 'lucide-react';
import { guessColumn, normalizeRevenue, parseLeadDate } from '@/lib/normalize';

interface Vendor { id: string; name: string }

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const splitLine = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const cols = splitLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

export default function InventoryUploadPage() {
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!activeOrgId) return;
    supabase
      .from('vendors')
      .select('id, name')
      .eq('organization_id', activeOrgId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setVendors((data ?? []) as Vendor[]));
  }, [activeOrgId]);

  const handleFile = async (f: File) => {
    setFile(f);
    const text = await f.text();
    const { headers: h, rows: r } = parseCSV(text);
    setHeaders(h);
    setRows(r);
    setMapping({
      vin: guessColumn(h, ['vin']),
      stock_number: guessColumn(h, ['stock', 'stock #', 'stock number', 'stock_no']),
      vehicle_year: guessColumn(h, ['year', 'model year']),
      vehicle_make: guessColumn(h, ['make']),
      vehicle_model: guessColumn(h, ['model']),
      vehicle_trim: guessColumn(h, ['trim']),
      mileage: guessColumn(h, ['mileage', 'miles', 'odometer']),
      price: guessColumn(h, ['price', 'list price', 'asking']),
      listed_at: guessColumn(h, ['listed', 'date listed', 'list date', 'date']),
    });
  };

  const upload = async () => {
    if (!activeOrgId || !user || !vendorId || rows.length === 0) {
      toast.error('Pick a vendor and a CSV file');
      return;
    }
    setUploading(true);
    try {
      // Create raw upload audit row
      const { data: rawUp, error: rawErr } = await supabase
        .from('raw_inventory_uploads')
        .insert({
          organization_id: activeOrgId,
          vendor_id: vendorId,
          uploaded_by: user.id,
          filename: file?.name ?? null,
          row_count: rows.length,
          column_mapping: mapping as any,
        })
        .select('id')
        .single();
      if (rawErr) throw rawErr;

      const records = rows.map(row => {
        const get = (k: string) => {
          const col = mapping[k];
          return col ? row[col] : null;
        };
        const yearStr = get('vehicle_year');
        const mileageStr = get('mileage');
        return {
          organization_id: activeOrgId,
          vendor_id: vendorId,
          raw_upload_id: rawUp.id,
          vin: get('vin') || null,
          stock_number: get('stock_number') || null,
          vehicle_year: yearStr ? parseInt(yearStr, 10) || null : null,
          vehicle_make: get('vehicle_make') || null,
          vehicle_model: get('vehicle_model') || null,
          vehicle_trim: get('vehicle_trim') || null,
          mileage: mileageStr ? parseInt(String(mileageStr).replace(/\D/g, ''), 10) || null : null,
          price: normalizeRevenue(get('price')),
          listed_at: parseLeadDate(get('listed_at')),
          status: 'active',
        };
      }).filter(r => r.vin || r.stock_number || r.vehicle_model);

      // Insert in chunks
      const CHUNK = 500;
      let inserted = 0;
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        const { error } = await supabase.from('vendor_inventory').insert(chunk);
        if (error) throw error;
        inserted += chunk.length;
      }

      await supabase
        .from('raw_inventory_uploads')
        .update({ inserted_count: inserted })
        .eq('id', rawUp.id);

      toast.success(`Uploaded ${inserted} inventory items`);
      setFile(null);
      setHeaders([]);
      setRows([]);
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (!activeOrgId) {
    return <p className="text-sm text-muted-foreground">Select a dealership.</p>;
  }

  const fields = [
    { key: 'vin', label: 'VIN' },
    { key: 'stock_number', label: 'Stock #' },
    { key: 'vehicle_year', label: 'Year' },
    { key: 'vehicle_make', label: 'Make' },
    { key: 'vehicle_model', label: 'Model' },
    { key: 'vehicle_trim', label: 'Trim' },
    { key: 'mileage', label: 'Mileage' },
    { key: 'price', label: 'Price' },
    { key: 'listed_at', label: 'Listed Date' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Upload Vendor Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Import a CSV of vehicles a vendor is currently advertising.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Select vendor & file</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Pick vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>CSV file</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Column mapping ({rows.length} rows)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {fields.map(f => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Select
                  value={mapping[f.key] ?? '__none__'}
                  onValueChange={v =>
                    setMapping(m => ({ ...m, [f.key]: v === '__none__' ? null : v }))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— skip —</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Button onClick={upload} disabled={uploading || !vendorId} size="lg">
          <UploadIcon className="mr-2 h-4 w-4" />
          {uploading ? 'Uploading...' : `Import ${rows.length} vehicles`}
        </Button>
      )}
    </div>
  );
}
