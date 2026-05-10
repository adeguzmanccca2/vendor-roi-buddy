import { useEffect, useMemo, useState } from 'react';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Pencil, Download, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Upload } from 'lucide-react';
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
  created_at: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  id: string;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  vehicle_of_interest: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vin: string | null;
  lead_date: string | null;
  lead_status: string;
  vendor_id: string | null;
  manual_override: boolean;
  source_label: string | null;
  type_of_vehicle: string | null;
  type_of_leads: string | null;
  stock_number: string | null;
}

const STATUS_OPTIONS = ['new', 'contacted', 'appointment', 'sold', 'lost'];

type SortKey = 'lead_date' | 'customer_full_name' | 'customer_email' | 'vin' | 'vehicle' | 'vendor' | 'lead_status';

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </TableHead>
  );
}

const emptyForm = {
  customer_full_name: '',
  customer_email: '',
  customer_phone: '',
  vehicle_of_interest: '',
  lead_date: '',
  lead_status: 'new',
  vendor_id: 'none',
  notes: '',
  stock_number: '',
};

export default function LeadsPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ vendor: 'all', status: 'all', search: '', vin: '' });
  const [sortKey, setSortKey] = useState<SortKey>('lead_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [dateDeleteOpen, setDateDeleteOpen] = useState(false);
  const [deleteFrom, setDeleteFrom] = useState('');
  const [deleteTo, setDeleteTo] = useState('');
  const [deletingByDate, setDeletingByDate] = useState(false);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };

  const load = async () => {
    if (!activeOrgId) { setLeads([]); setVendors([]); setLoading(false); return; }
    setLoading(true);
    const [{ data: l }, { data: v }] = await Promise.all([
      supabase
        .from('leads')
        .select('id, created_at, customer_first_name, customer_last_name, customer_full_name, customer_email, customer_phone, vehicle_of_interest, vehicle_year, vehicle_make, vehicle_model, vin, lead_date, lead_status, vendor_id, manual_override, source_label, type_of_vehicle, type_of_leads, stock_number')
        .eq('organization_id', activeOrgId)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(1000),
      supabase.from('vendors').select('id, name, is_active').eq('organization_id', activeOrgId).order('name'),
    ]);
    setLeads((l ?? []) as Lead[]);
    setVendors((v ?? []) as Vendor[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrgId]);

  const vehicleStr = (l: Lead) =>
    l.vehicle_of_interest ||
    [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(' ') ||
    '';

  const customerName = (l: Lead) =>
    [l.customer_first_name, l.customer_last_name].filter(Boolean).join(' ') ||
    l.customer_full_name ||
    '—';

  const vendorName = (id: string | null) => id ? vendors.find(v => v.id === id)?.name ?? '—' : '—';

  const filtered = useMemo(() => {
    const vinQ = filter.vin.trim().toLowerCase();
    const q = filter.search.trim().toLowerCase();
    return leads.filter(l => {
      if (filter.vendor !== 'all') {
        if (filter.vendor === 'unassigned' && l.vendor_id) return false;
        if (filter.vendor !== 'unassigned' && l.vendor_id !== filter.vendor) return false;
      }
      if (filter.status !== 'all' && l.lead_status !== filter.status) return false;
      if (vinQ && !(l.vin ?? '').toLowerCase().includes(vinQ)) return false;
      if (q) {
        const hay = `${l.customer_full_name ?? ''} ${l.customer_email ?? ''} ${l.customer_phone ?? ''} ${l.vehicle_of_interest ?? ''} ${l.vin ?? ''} ${vendorName(l.vendor_id)} ${l.source_label ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, filter, vendors]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    const getVal = (l: Lead): string | number | null => {
      switch (sortKey) {
        case 'lead_date': return l.lead_date ? new Date(l.lead_date).getTime() : null;
        case 'customer_full_name': return l.customer_full_name;
        case 'customer_email': return l.customer_email;
        case 'vin': return l.vin;
        case 'vehicle': return vehicleStr(l) || null;
        case 'vendor': return vendorName(l.vendor_id);
        case 'lead_status': return l.lead_status;
      }
    };
    arr.sort((a, b) => {
      const av = getVal(a); const bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir, vendors]);


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
      stock_number: l.stock_number ?? '',
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
      vin: null,
      stock_number: form.stock_number.trim() || null,
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
      stock_number: form.stock_number.trim() || null,
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


  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(filtered.map(l => l.id)) : new Set());
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selected);
    const { error } = await supabase.from('leads').delete().in('id', ids);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length} lead${ids.length === 1 ? '' : 's'}`);
    setLeads(prev => prev.filter(l => !selected.has(l.id)));
    setSelected(new Set());
  };

  const deleteByDate = async () => {
    if (!activeOrgId || !deleteFrom || !deleteTo) return;
    setDeletingByDate(true);
    const fromIso = new Date(`${deleteFrom}T00:00:00`).toISOString();
    const toIso = new Date(`${deleteTo}T23:59:59.999`).toISOString();
    const { data, error } = await supabase
      .from('leads')
      .delete()
      .eq('organization_id', activeOrgId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .select('id');
    setDeletingByDate(false);
    if (error) return toast.error(error.message);
    const count = data?.length ?? 0;
    toast.success(`Deleted ${count} lead${count === 1 ? '' : 's'}`);
    setDateDeleteOpen(false);
    setDeleteFrom('');
    setDeleteTo('');
    setSelected(new Set());
    load();
  };

  const deleteOne = async (id: string) => {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Lead deleted');
    setLeads(prev => prev.filter(l => l.id !== id));
    setSelected(prev => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  };


  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership to view leads.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">{activeOrg?.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleting}>
                  <Trash2 className="mr-1 h-4 w-4" /> Delete {selected.size}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selected.size} lead{selected.size === 1 ? '' : 's'}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the selected leads. Any sales attributed to them will be unlinked. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
	<Button variant="outline" asChild>
  	    <Link to="/upload"><Upload className="mr-1 h-4 w-4" /> Upload leads</Link>
	</Button>
          <Button variant="outline" onClick={() => {
            const vMap = new Map(vendors.map(v => [v.id, v.name]));
            downloadCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`, leads.map(l => ({
              date: l.lead_date ?? '',
              customer: l.customer_full_name ?? '',
              email: l.customer_email ?? '',
              phone: l.customer_phone ?? '',
              vin: l.vin ?? '',
              stock_number: l.stock_number ?? '',
              vehicle: l.vehicle_of_interest ?? '',
              status: l.lead_status,
              vendor: l.vendor_id ? vMap.get(l.vendor_id) ?? '' : '',
              manual_override: l.manual_override ? 'yes' : 'no',
            })));
          }} disabled={leads.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          <Dialog open={dateDeleteOpen} onOpenChange={setDateDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Trash2 className="mr-1 h-4 w-4" /> Delete by date
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Delete leads by upload date</DialogTitle>
                <DialogDescription>
                  Permanently removes all leads uploaded within the selected date range. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-2">
                <div className="grid gap-2">
                  <Label>From</Label>
                  <Input type="date" value={deleteFrom} onChange={e => setDeleteFrom(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>To</Label>
                  <Input type="date" value={deleteTo} onChange={e => setDeleteTo(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDateDeleteOpen(false)} disabled={deletingByDate}>Cancel</Button>
                <Button
                  onClick={deleteByDate}
                  disabled={!deleteFrom || !deleteTo || deletingByDate}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete leads
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
                <div className="grid gap-2">
                  <Label>Stock #</Label>
                  <Input
                    placeholder="e.g. STK12345"
                    value={form.stock_number}
                    onChange={e => setForm({ ...form, stock_number: e.target.value })}
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
            <div className="flex items-center gap-2">
              <CardTitle>All Leads</CardTitle>
              <span className="rounded-md border border-border bg-muted px-2 py-1 text-sm font-medium text-foreground">
                {filtered.length.toLocaleString()} {filtered.length === 1 ? 'record' : 'records'}
              </span>
              {filtered.length !== leads.length && (
                <span className="text-sm text-muted-foreground">
                  of {leads.length.toLocaleString()} total
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Search anything…"
                className="w-56"
                value={filter.search}
                onChange={e => setFilter({ ...filter, search: e.target.value })}
              />
              <Input
                placeholder="VIN contains…"
                className="w-44"
                value={filter.vin}
                onChange={e => setFilter({ ...filter, vin: e.target.value })}
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
          ) : sorted.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No leads match.</p>
          ) : (
            <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto rounded-md border border-border pb-3">
              <div className="min-w-[1400px]">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={sorted.length > 0 && sorted.every(l => selected.has(l.id))}
                        onCheckedChange={(c) => toggleAll(!!c)}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Uploaded</TableHead>
                    <TableHead className="whitespace-nowrap">Lead Date</TableHead>
                    <SortHeader label="Customer" k="customer_full_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortHeader label="Email" k="customer_email" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <TableHead>Phone</TableHead>
                    <SortHeader label="VIN" k="vin" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <TableHead>Stock #</TableHead>
                    <SortHeader label="Vehicle" k="vehicle" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <TableHead>Source</TableHead>
		    <TableHead>Type of vehicle</TableHead>
		    <TableHead>Type of leads</TableHead>
                    <SortHeader label="Vendor" k="vendor" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortHeader label="Status" k="lead_status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map(l => (
                    <TableRow key={l.id} data-state={selected.has(l.id) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={(c) => toggleOne(l.id, !!c)}
                          aria-label={`Select lead ${l.customer_full_name ?? ''}`}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {l.lead_date ? new Date(l.lead_date).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="font-medium">
                        {customerName(l)}
                        {l.manual_override && <Badge variant="outline" className="ml-2 text-[10px]">manual</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">{l.customer_email ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{l.customer_phone ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{l.vin ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{l.stock_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{vehicleStr(l) || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.source_label ?? '—'}</TableCell>
		      <TableCell className="text-xs text-muted-foreground">{l.type_of_vehicle ?? '—'}</TableCell>
		      <TableCell className="text-xs text-muted-foreground">{l.type_of_leads ?? '—'}</TableCell>
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
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(l)} aria-label="Edit lead">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" aria-label="Delete lead">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Permanently removes {l.customer_full_name ?? 'this lead'}. Any sales attributed to it will be unlinked.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteOne(l.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
