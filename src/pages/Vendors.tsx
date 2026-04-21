import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Vendor {
  id: string;
  organization_id: string;
  name: string;
  vendor_type: string | null;
  monthly_cost: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  notes: string | null;
}

const empty = {
  name: '',
  vendor_type: '',
  monthly_cost: '0',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  is_active: true,
  notes: '',
};

export default function VendorsPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState({ ...empty });

  const load = async () => {
    if (!activeOrgId) { setVendors([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setVendors((data ?? []) as Vendor[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrgId]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (v: Vendor) => {
    setEditing(v);
    setForm({
      name: v.name,
      vendor_type: v.vendor_type ?? '',
      monthly_cost: String(v.monthly_cost ?? 0),
      contact_name: v.contact_name ?? '',
      contact_email: v.contact_email ?? '',
      contact_phone: v.contact_phone ?? '',
      is_active: v.is_active,
      notes: v.notes ?? '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!activeOrgId) return toast.error('No active dealership');
    if (!form.name.trim()) return toast.error('Name required');
    const payload = {
      organization_id: activeOrgId,
      name: form.name.trim(),
      vendor_type: form.vendor_type.trim() || null,
      monthly_cost: Number(form.monthly_cost) || 0,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    };
    const { error } = editing
      ? await supabase.from('vendors').update(payload).eq('id', editing.id)
      : await supabase.from('vendors').insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editing ? 'Vendor updated' : 'Vendor created');
    setOpen(false);
    load();
  };

  const remove = async (v: Vendor) => {
    if (!confirm(`Delete vendor "${v.name}"? Leads will keep their data but lose vendor link.`)) return;
    const { error } = await supabase.from('vendors').delete().eq('id', v.id);
    if (error) return toast.error(error.message);
    toast.success('Vendor deleted');
    load();
  };

  if (!activeOrgId) {
    return <p className="text-sm text-muted-foreground">Select a dealership to manage vendors.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vendors</h1>
          <p className="text-sm text-muted-foreground">
            Lead sources for {activeOrg?.name ?? 'this dealership'}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Add vendor</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit vendor' : 'New vendor'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Input
                    placeholder="e.g. AutoTrader, Website"
                    value={form.vendor_type}
                    onChange={e => setForm({ ...form, vendor_type: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Monthly cost ($)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.monthly_cost}
                    onChange={e => setForm({ ...form, monthly_cost: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Contact name</Label>
                <Input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Contact email</Label>
                  <Input value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Contact phone</Label>
                  <Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Notes</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="active">Active</Label>
                <Switch id="active" checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save}>{editing ? 'Save changes' : 'Create vendor'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>All Vendors ({vendors.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : vendors.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No vendors yet. Add your first lead source.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Monthly cost</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendors.map(v => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.vendor_type ?? '—'}</TableCell>
                      <TableCell>${Number(v.monthly_cost ?? 0).toFixed(2)}</TableCell>
                      <TableCell className="text-sm">
                        {v.contact_name ?? '—'}
                        {v.contact_email && <div className="text-xs text-muted-foreground">{v.contact_email}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={v.is_active ? 'default' : 'secondary'}>
                          {v.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(v)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(v)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
