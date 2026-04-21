import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Trash2, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { downloadCsv } from '@/lib/exportCsv';

interface Vendor { id: string; name: string }
interface Item {
  id: string;
  vin: string | null;
  stock_number: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_trim: string | null;
  mileage: number | null;
  price: number | null;
  status: string;
  listed_at: string | null;
  vendor_id: string;
  vendor?: { name: string };
}

export default function InventoryPage() {
  const { activeOrgId } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    let q = supabase
      .from('vendor_inventory')
      .select('*, vendors(name)')
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (vendorFilter !== 'all') q = q.eq('vendor_id', vendorFilter);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setItems((data ?? []).map((r: any) => ({ ...r, vendor: r.vendors })) as Item[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!activeOrgId) return;
    supabase
      .from('vendors')
      .select('id, name')
      .eq('organization_id', activeOrgId)
      .order('name')
      .then(({ data }) => setVendors((data ?? []) as Vendor[]));
  }, [activeOrgId]);

  useEffect(() => { load(); }, [activeOrgId, vendorFilter, statusFilter]);

  const filtered = items.filter(i => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      i.vin?.toLowerCase().includes(s) ||
      i.stock_number?.toLowerCase().includes(s) ||
      i.vehicle_make?.toLowerCase().includes(s) ||
      i.vehicle_model?.toLowerCase().includes(s)
    );
  });

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this inventory item?')) return;
    const { error } = await supabase.from('vendor_inventory').delete().eq('id', id);
    if (error) toast.error(error.message);
    else load();
  };

  const updateStatus = async (id: string, status: string) => {
    const patch: any = { status };
    if (status === 'sold' || status === 'removed') patch.removed_at = new Date().toISOString();
    const { error } = await supabase.from('vendor_inventory').update(patch).eq('id', id);
    if (error) toast.error(error.message);
    else load();
  };

  const exportData = () => {
    downloadCsv(
      'inventory.csv',
      filtered.map(i => ({
        Vendor: i.vendor?.name ?? '',
        VIN: i.vin ?? '',
        Stock: i.stock_number ?? '',
        Year: i.vehicle_year ?? '',
        Make: i.vehicle_make ?? '',
        Model: i.vehicle_model ?? '',
        Trim: i.vehicle_trim ?? '',
        Mileage: i.mileage ?? '',
        Price: i.price ?? '',
        Status: i.status,
        Listed: i.listed_at ?? '',
      })),
    );
  };

  if (!activeOrgId) {
    return <p className="text-sm text-muted-foreground">Select a dealership.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vendor Inventory</h1>
          <p className="text-sm text-muted-foreground">Vehicles being advertised by your vendors.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportData} disabled={filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" />Export
          </Button>
          <Button asChild>
            <Link to="/inventory/upload">Upload CSV</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Select value={vendorFilter} onValueChange={setVendorFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="sold">Sold</SelectItem>
              <SelectItem value="removed">Removed</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Search VIN, stock, make, model..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No inventory found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>VIN</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Mileage</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(i => (
                  <TableRow key={i.id}>
                    <TableCell className="text-xs">{i.vendor?.name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{i.stock_number ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{i.vin ?? '—'}</TableCell>
                    <TableCell>
                      {[i.vehicle_year, i.vehicle_make, i.vehicle_model, i.vehicle_trim].filter(Boolean).join(' ') || '—'}
                    </TableCell>
                    <TableCell>{i.mileage?.toLocaleString() ?? '—'}</TableCell>
                    <TableCell>{i.price != null ? `$${Number(i.price).toLocaleString()}` : '—'}</TableCell>
                    <TableCell>
                      <Select value={i.status} onValueChange={v => updateStatus(i.id, v)}>
                        <SelectTrigger className="h-8 w-28">
                          <Badge
                            variant={i.status === 'active' ? 'default' : i.status === 'sold' ? 'secondary' : 'outline'}
                          >
                            {i.status}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="sold">Sold</SelectItem>
                          <SelectItem value="removed">Removed</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => deleteItem(i.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
