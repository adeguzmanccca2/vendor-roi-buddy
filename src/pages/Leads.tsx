import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Upload, Pencil, Download, Trash2 } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';
import { toast } from 'sonner';
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  splitName,
  parseLeadDate,
  parseVehicle,
  buildDedupHash,
} from '@/lib/normalize';

interface Vendor { id: string; name: string; is_active: boolean }
interface Lead {
  id: string;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  vehicle_of_interest: string | null;
  lead_date: string | null;
  lead_status: string;
  vendor_id: string | null;
  manual_override: boolean;
}

const STATUS_OPTIONS = ['new', 'contacted', 'appointment', 'sold', 'lost'];

const emptyForm = {
  customer_full_name: '',
  customer_email: '',
  customer_phone: '',
  vehicle_of_interest: '',
  lead_date: '',
  lead_status: 'new',
  vendor_id: 'none',
  notes: '',
};

export default function LeadsPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ vendor: 'all', status: 'all', search: '' });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const load = async () => {
    if (!activeOrgId) { setLeads([]); setVendors([]); setLoading(false); return; }
    setLoading(true);
    const [{ data: l }, { data: v }] = await Promise.all([
      supabase.from('leads').select('*').eq('organization_id', activeOrgId).order('lead_date', { ascending: false, nullsFirst: false }).limit(500),
      supabase.from('vendors').select('id, name, is_active').eq('organization_id', activeOrgId).order('name'),
    ]);
    setLeads((l ?? []) as Lead[]);
    setVendors((v ?? []) as Vendor[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrgId]);

  const filtered = leads.filter(l => {
    if (filter.vendor !== 'all') {
      if (filter.vendor === 'unassigned' && l.vendor_id) return false;
      if (filter.vendor !== 'unassigned' && l.vendor_id !== filter.vendor) return false;
    }
    if (filter.status !== 'all' && l.lead_status !== filter.status) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const hay = `${l.customer_full_name ?? ''} ${l.customer_email ?? ''} ${l.customer_phone ?? ''} ${l.vehicle_of_interest ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setOpen(true); };

  const openEdit = (l: Lead) => {
    setEditing(l);
    setForm({
      customer_full_name: l.customer_full_name ?? '',
      customer_email: l.customer_email ?? '',
      customer_phone: l.customer_phone ?? '',
      vehicle_of_interest: l.vehicle_of_interest ?? '',
      lead_date: l.lead_date ? l.lead_date.slice(0, 10) : '',
      lead_status: l.lead_status,
      vendor_id: l.vendor_id ?? 'none',
      notes: '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!activeOrgId) return;
    const fullName = form.customer_full_name.trim();
    if (!fullName && !form.customer_email && !form.customer_phone) {
      return toast.error('Provide at least name, email, or phone');
    }
    const { first, last } = splitName(fullName);
    const normEmail = normalizeEmail(form.customer_email);
    const normPhone = normalizePhone(form.customer_phone);
    const veh = parseVehicle(form.vehicle_of_interest);
    const hash = await buildDedupHash({
      email: normEmail,
      phone: normPhone,
      name: normalizeName(fullName),
      vehicle: normalizeName(form.vehicle_of_interest),
    });

    const payload = {
      organization_id: activeOrgId,
      vendor_id: form.vendor_id === 'none' ? null : form.vendor_id,
      customer_first_name: first,
      customer_last_name: last,
      customer_full_name: fullName || null,
      customer_email: form.customer_email.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      normalized_email: normEmail,
      normalized_phone: normPhone,
      dedup_hash: hash,
      vehicle_of_interest: form.vehicle_of_interest.trim() || null,
      vehicle_year: veh.year,
      vehicle_make: veh.make,
      vehicle_model: veh.model,
      lead_date: form.lead_date ? new Date(form.lead_date).toISOString() : new Date().toISOString(),
      lead_status: form.lead_status,
      notes: form.notes.trim() || null,
      manual_override: true,
    };

    const { error } = editing
      ? await supabase.from('leads').update(payload).eq('id', editing.id)
      : await supabase.from('leads').insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editing ? 'Lead updated' : 'Lead created');
    setOpen(false);
    load();
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('leads').update({ lead_status: status }).eq('id', id);
    if (error) return toast.error(error.message);
    setLeads(prev => prev.map(l => l.id === id ? { ...l, lead_status: status } : l));
  };

  const updateVendor = async (id: string, vendorId: string) => {
    const v = vendorId === 'none' ? null : vendorId;
    const { error } = await supabase.from('leads').update({ vendor_id: v, manual_override: true }).eq('id', id);
    if (error) return toast.error(error.message);
    setLeads(prev => prev.map(l => l.id === id ? { ...l, vendor_id: v, manual_override: true } : l));
  };

  const vendorName = (id: string | null) => id ? vendors.find(v => v.id === id)?.name ?? '—' : '—';

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership to view leads.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">{activeOrg?.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => {
            const vMap = new Map(vendors.map(v => [v.id, v.name]));
            downloadCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`, leads.map(l => ({
              date: l.lead_date ?? '',
              customer: l.customer_full_name ?? '',
              email: l.customer_email ?? '',
              phone: l.customer_phone ?? '',
              vehicle: l.vehicle_of_interest ?? '',
              status: l.lead_status,
              vendor: l.vendor_id ? vMap.get(l.vendor_id) ?? '' : '',
              manual_override: l.manual_override ? 'yes' : 'no',
            })));
          }} disabled={leads.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          <Button asChild variant="outline">
            <Link to="/upload"><Upload className="mr-1 h-4 w-4" /> Upload CSV</Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Add lead</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit lead' : 'New lead'}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="grid gap-2">
                  <Label>Customer name</Label>
                  <Input value={form.customer_full_name} onChange={e => setForm({ ...form, customer_full_name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Email</Label>
                    <Input value={form.customer_email} onChange={e => setForm({ ...form, customer_email: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Phone</Label>
                    <Input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Vehicle of interest</Label>
                  <Input
                    placeholder="2024 Ford F-150"
                    value={form.vehicle_of_interest}
                    onChange={e => setForm({ ...form, vehicle_of_interest: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Lead date</Label>
                    <Input type="date" value={form.lead_date} onChange={e => setForm({ ...form, lead_date: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Status</Label>
                    <Select value={form.lead_status} onValueChange={v => setForm({ ...form, lead_status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Vendor</Label>
                  <Select value={form.vendor_id} onValueChange={v => setForm({ ...form, vendor_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Unassigned —</SelectItem>
                      {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Notes</Label>
                  <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save}>{editing ? 'Save changes' : 'Create lead'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <CardTitle>All Leads ({filtered.length})</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Search name/email/phone/vehicle"
                className="w-64"
                value={filter.search}
                onChange={e => setFilter({ ...filter, search: e.target.value })}
              />
              <Select value={filter.vendor} onValueChange={v => setFilter({ ...filter, vendor: v })}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vendors</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filter.status} onValueChange={v => setFilter({ ...filter, status: v })}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No leads match.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.lead_date ? new Date(l.lead_date).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="font-medium">
                        {l.customer_full_name ?? '—'}
                        {l.manual_override && <Badge variant="outline" className="ml-2 text-[10px]">manual</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{l.customer_email ?? '—'}</div>
                        <div className="text-muted-foreground">{l.customer_phone ?? '—'}</div>
                      </TableCell>
                      <TableCell className="text-sm">{l.vehicle_of_interest ?? '—'}</TableCell>
                      <TableCell>
                        <Select value={l.vendor_id ?? 'none'} onValueChange={v => updateVendor(l.id, v)}>
                          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Unassigned —</SelectItem>
                            {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={l.lead_status} onValueChange={v => updateStatus(l.id, v)}>
                          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(l)}>
                          <Pencil className="h-4 w-4" />
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
