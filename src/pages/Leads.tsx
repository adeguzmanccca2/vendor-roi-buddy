import { useCallback, useEffect, useState } from 'react';
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
import { Plus, Pencil, Download, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Upload, ChevronLeft, ChevronRight, X, Link2 } from 'lucide-react';
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
  created_at: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
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
  sale_id: string | null;
}

interface SaleMatch {
  id: string;
  customer_full_name: string | null;
  customer_phone: string | null;
  vin: string | null;
  stock_number: string | null;
  sale_date: string | null;
  sale_price: number | null;
  attribution_status: string;
}

const STATUS_OPTIONS = ['new', 'contacted', 'appointment', 'sold', 'lost'];
const PAGE_SIZE = 100;

// WHY: SortKey maps to actual DB column names so we can pass them directly
// to Supabase .order() for server-side sorting.
type SortKey = 'created_at' | 'lead_date' | 'customer_full_name' | 'customer_email' | 'vin' | 'lead_status';

const SELECT_FIELDS = 'id, created_at, customer_first_name, customer_last_name, customer_full_name, customer_email, customer_phone, vehicle_of_interest, vehicle_year, vehicle_make, vehicle_model, vin, lead_date, lead_status, vendor_id, manual_override, source_label, type_of_vehicle, type_of_leads, stock_number, sale_id';

function SortHeader({ label, k, sortKey, sortDir, onClick }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc'; onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead>
      <button type="button" onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}<Icon className="h-3 w-3" />
      </button>
    </TableHead>
  );
}

const emptyForm = {
  customer_full_name: '', customer_email: '', customer_phone: '',
  vehicle_of_interest: '', lead_date: '', lead_status: 'new',
  vendor_id: 'none', notes: '', stock_number: '',
};

export default function LeadsPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState('');
  const [vinSearch, setVinSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('all');

  // WHY: Replaced statusFilter with two lead_date range states.
  // This lets users filter leads by when the lead actually occurred (lead_date),
  // which is far more useful than filtering by status for ROI/attribution analysis.
  const [leadDateFrom, setLeadDateFrom] = useState('');
  const [leadDateTo, setLeadDateTo] = useState('');

  const [sortKey, setSortKey] = useState<SortKey>('created_at');
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

  // Link-to-sale state
  const [linkModalOpen, setLinkModalOpen]   = useState(false);
  const [linkingLead, setLinkingLead]       = useState<Lead | null>(null);
  const [saleSearch, setSaleSearch]         = useState('');
  const [saleResults, setSaleResults]       = useState<SaleMatch[]>([]);
  const [saleSearching, setSaleSearching]   = useState(false);
  const [linking, setLinking]               = useState(false);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
    setPage(0);
  };

  // ---------------------------------------------------------------------------
  // WHY useCallback + useEffect: load() depends on all filter/sort/page state.
  // useCallback memoizes it so useEffect only re-runs when dependencies change.
  // Every filter change resets page to 0 via the apply* helpers below.
  // ---------------------------------------------------------------------------
  const load = useCallback(async () => {
    if (!activeOrgId) { setLeads([]); setTotalCount(0); setLoading(false); return; }
    setLoading(true);

    const buildQuery = (q: any) => {
      q = q.eq('organization_id', activeOrgId);
      if (vendorFilter === 'unassigned') q = q.is('vendor_id', null);
      else if (vendorFilter !== 'all') q = q.eq('vendor_id', vendorFilter);

      // WHY: Filter by lead_date range instead of status. We convert the local
      // date strings to ISO so Supabase can compare against the timestamptz column.
      // We use gte (start of from-day) and lte (end of to-day) for inclusive range.
      if (leadDateFrom) {
        q = q.gte('lead_date', new Date(`${leadDateFrom}T00:00:00`).toISOString());
      }
      if (leadDateTo) {
        q = q.lte('lead_date', new Date(`${leadDateTo}T23:59:59.999`).toISOString());
      }

      if (vinSearch.trim()) q = q.ilike('vin', `%${vinSearch.trim()}%`);
      if (search.trim()) {
        const s = search.trim();
        q = q.or(
          `customer_full_name.ilike.%${s}%,customer_first_name.ilike.%${s}%,customer_last_name.ilike.%${s}%,customer_email.ilike.%${s}%,customer_phone.ilike.%${s}%,vehicle_of_interest.ilike.%${s}%,stock_number.ilike.%${s}%,source_label.ilike.%${s}%,type_of_leads.ilike.%${s}%,type_of_vehicle.ilike.%${s}%`
        );
      }
      return q;
    };

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const [countResult, dataResult] = await Promise.all([
      buildQuery(supabase.from('leads').select('id', { count: 'exact', head: true })),
      buildQuery(supabase.from('leads').select(SELECT_FIELDS))
        .order(sortKey, { ascending: sortDir === 'asc', nullsFirst: false })
        .range(from, to),
    ]);

    setTotalCount(countResult.count ?? 0);
    setLeads((dataResult.data ?? []) as Lead[]);
    setLoading(false);
  // WHY: leadDateFrom/leadDateTo replace statusFilter in the dependency array
  }, [activeOrgId, page, search, vinSearch, vendorFilter, leadDateFrom, leadDateTo, sortKey, sortDir]);

  useEffect(() => {
    if (!activeOrgId) return;
    supabase.from('vendors').select('id, name, is_active').eq('organization_id', activeOrgId).order('name')
      .then(({ data }) => setVendors((data ?? []) as Vendor[]));
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  const applySearch = (val: string) => { setSearch(val); setPage(0); };
  const applyVin = (val: string) => { setVinSearch(val); setPage(0); };
  const applyVendor = (val: string) => { setVendorFilter(val); setPage(0); };
  const applyLeadDateFrom = (val: string) => { setLeadDateFrom(val); setPage(0); };
  const applyLeadDateTo = (val: string) => { setLeadDateTo(val); setPage(0); };
  const clearDateRange = () => { setLeadDateFrom(''); setLeadDateTo(''); setPage(0); };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const vehicleStr = (l: Lead) =>
    l.vehicle_of_interest ||
    [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(' ') || '';

  const customerName = (l: Lead) =>
    [l.customer_first_name, l.customer_last_name].filter(Boolean).join(' ') ||
    l.customer_full_name || '—';

  const vendorName = (id: string | null) =>
    id ? vendors.find(v => v.id === id)?.name ?? '—' : '—';

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
    if (!fullName && !form.customer_email && !form.customer_phone)
      return toast.error('Provide at least name, email, or phone');
    const { first, last } = splitName(fullName);
    const normEmail = normalizeEmail(form.customer_email);
    const normPhone = normalizePhone(form.customer_phone);
    const veh = parseVehicle(form.vehicle_of_interest);
    const hash = await buildDedupHash({
      email: normEmail, phone: normPhone,
      name: normalizeName(fullName),
      vehicle: normalizeName(form.vehicle_of_interest),
      vin: null, stock_number: form.stock_number.trim() || null,
    });
    const payload = {
      organization_id: activeOrgId,
      vendor_id: form.vendor_id === 'none' ? null : form.vendor_id,
      customer_first_name: first, customer_last_name: last,
      customer_full_name: fullName || null,
      customer_email: form.customer_email.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      normalized_email: normEmail, normalized_phone: normPhone,
      dedup_hash: hash,
      vehicle_of_interest: form.vehicle_of_interest.trim() || null,
      vehicle_year: veh.year, vehicle_make: veh.make, vehicle_model: veh.model,
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
    setSelected(prev => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; });
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(leads.map(l => l.id)) : new Set());
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selected);
    const { error } = await supabase.from('leads').delete().in('id', ids);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length} lead${ids.length === 1 ? '' : 's'}`);
    setSelected(new Set());
    load();
  };

  const deleteByDate = async () => {
    if (!activeOrgId || !deleteFrom || !deleteTo) return;
    setDeletingByDate(true);
    const fromIso = new Date(`${deleteFrom}T00:00:00`).toISOString();
    const toIso = new Date(`${deleteTo}T23:59:59.999`).toISOString();
    const { data, error } = await supabase.from('leads').delete()
      .eq('organization_id', activeOrgId)
      .gte('created_at', fromIso).lte('created_at', toIso).select('id');
    setDeletingByDate(false);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${data?.length ?? 0} lead${(data?.length ?? 0) === 1 ? '' : 's'}`);
    setDateDeleteOpen(false); setDeleteFrom(''); setDeleteTo('');
    setSelected(new Set());
    load();
  };

  const openLinkModal = (lead: Lead) => {
    setLinkingLead(lead);
    setSaleSearch('');
    setSaleResults([]);
    setLinkModalOpen(true);
  };

  const searchSales = async (q: string) => {
    setSaleSearch(q);
    if (!activeOrgId || q.trim().length < 2) { setSaleResults([]); return; }
    setSaleSearching(true);
    // Search unmatched sales only (no lead_id) by name, VIN, or stock#
    const { data } = await supabase
      .from('sales')
      .select('id, customer_full_name, customer_phone, vin, stock_number, sale_date, sale_price, attribution_status')
      .eq('organization_id', activeOrgId)
      .is('lead_id', null)
      .or(`customer_full_name.ilike.%${q.trim()}%,vin.ilike.%${q.trim()}%,stock_number.ilike.%${q.trim()}%,customer_phone.ilike.%${q.trim()}%`)
      .order('sale_date', { ascending: false })
      .limit(20);
    setSaleResults((data ?? []) as SaleMatch[]);
    setSaleSearching(false);
  };

  const linkToSale = async (sale: SaleMatch) => {
    if (!linkingLead || !activeOrgId) return;
    setLinking(true);
    try {
      // Update the sale: set lead_id, vendor_id from the lead, mark as manual
      const { error: saleErr } = await supabase
        .from('sales')
        .update({
          lead_id:               linkingLead.id,
          vendor_id:             linkingLead.vendor_id,
          attribution_status:    'manual',
          manual_override:       true,
          attribution_confidence: 100,
        })
        .eq('id', sale.id);
      if (saleErr) throw saleErr;

      // Update the lead: mark as sold
      const { error: leadErr } = await supabase
        .from('leads')
        .update({ lead_status: 'sold', sale_id: sale.id })
        .eq('id', linkingLead.id);
      if (leadErr) throw leadErr;

      toast.success(`Linked ${linkingLead.customer_full_name ?? 'lead'} → ${sale.customer_full_name ?? 'sale'}`);
      setLinkModalOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Link failed');
    } finally {
      setLinking(false);
    }
  };

  const deleteOne = async (id: string) => {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Lead deleted');
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    load();
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
                  <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
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
              uploaded: l.created_at ?? '',
              lead_date: l.lead_date ?? '',
              customer: customerName(l),
              email: l.customer_email ?? '',
              phone: l.customer_phone ?? '',
              vin: l.vin ?? '',
              stock_number: l.stock_number ?? '',
              vehicle: vehicleStr(l),
              source: l.source_label ?? '',
              type_of_vehicle: l.type_of_vehicle ?? '',
              type_of_leads: l.type_of_leads ?? '',
              status: l.lead_status,
              vendor: l.vendor_id ? vMap.get(l.vendor_id) ?? '' : '',
            })));
          }} disabled={leads.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export page
          </Button>
          <Dialog open={dateDeleteOpen} onOpenChange={setDateDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Trash2 className="mr-1 h-4 w-4" /> Delete by date</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Delete leads by upload date</DialogTitle>
                <DialogDescription>Permanently removes all leads uploaded within the selected date range. This cannot be undone.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-2">
                <div className="grid gap-2"><Label>From</Label><Input type="date" value={deleteFrom} onChange={e => setDeleteFrom(e.target.value)} /></div>
                <div className="grid gap-2"><Label>To</Label><Input type="date" value={deleteTo} onChange={e => setDeleteTo(e.target.value)} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDateDeleteOpen(false)} disabled={deletingByDate}>Cancel</Button>
                <Button onClick={deleteByDate} disabled={!deleteFrom || !deleteTo || deletingByDate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete leads</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Add lead</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing ? 'Edit lead' : 'New lead'}</DialogTitle></DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="grid gap-2"><Label>Customer name</Label><Input value={form.customer_full_name} onChange={e => setForm({ ...form, customer_full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2"><Label>Email</Label><Input value={form.customer_email} onChange={e => setForm({ ...form, customer_email: e.target.value })} /></div>
                  <div className="grid gap-2"><Label>Phone</Label><Input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} /></div>
                </div>
                <div className="grid gap-2"><Label>Vehicle of interest</Label><Input placeholder="2024 Ford F-150" value={form.vehicle_of_interest} onChange={e => setForm({ ...form, vehicle_of_interest: e.target.value })} /></div>
                <div className="grid gap-2"><Label>Stock #</Label><Input placeholder="e.g. STK12345" value={form.stock_number} onChange={e => setForm({ ...form, stock_number: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2"><Label>Lead date</Label><Input type="date" value={form.lead_date} onChange={e => setForm({ ...form, lead_date: e.target.value })} /></div>
                  <div className="grid gap-2">
                    <Label>Status</Label>
                    <Select value={form.lead_status} onValueChange={v => setForm({ ...form, lead_status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Vendor</Label>
                  <Select value={form.vendor_id} onValueChange={v => setForm({ ...form, vendor_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- Unassigned --</SelectItem>
                      {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save}>{editing ? 'Save changes' : 'Create lead'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="overflow-x-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-2">
              <CardTitle>All Leads</CardTitle>
              <span className="rounded-md border border-border bg-muted px-2 py-1 text-sm font-medium text-foreground">
                {totalCount.toLocaleString()} {totalCount === 1 ? 'record' : 'records'}
              </span>
              {totalPages > 1 && (
                <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Search name, email, phone, vehicle, stock..." className="w-64" value={search} onChange={e => applySearch(e.target.value)} />
              <Input placeholder="VIN contains..." className="w-44" value={vinSearch} onChange={e => applyVin(e.target.value)} />
              <Select value={vendorFilter} onValueChange={applyVendor}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vendors</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* WHY: Lead date range filter — replaces the status dropdown.
                  Two date inputs (From / To) filter by lead_date server-side.
                  The X button clears both dates at once for a quick reset. */}
              <div className="flex items-center gap-1">
                <Input
                  type="date"
                  className="w-36 text-xs"
                  title="Lead date from"
                  value={leadDateFrom}
                  onChange={e => applyLeadDateFrom(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="date"
                  className="w-36 text-xs"
                  title="Lead date to"
                  value={leadDateTo}
                  onChange={e => applyLeadDateTo(e.target.value)}
                />
                {(leadDateFrom || leadDateTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={clearDateRange}
                    title="Clear date filter"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : leads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No leads match.</p>
          ) : (
            <>
              <div className="max-h-[calc(100vh-420px)] min-h-[300px] overflow-auto rounded-md border border-border">
                  <Table className="min-w-[1400px]">
                    <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={leads.length > 0 && leads.every(l => selected.has(l.id))}
                            onCheckedChange={(c) => toggleAll(!!c)}
                            aria-label="Select all"
                          />
                        </TableHead>
                        <SortHeader label="Uploaded" k="created_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                        <SortHeader label="Lead Date" k="lead_date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                        <SortHeader label="Customer" k="customer_full_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                        <SortHeader label="Email" k="customer_email" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                        <TableHead>Phone</TableHead>
                        <SortHeader label="VIN" k="vin" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                        <TableHead>Stock #</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Type of vehicle</TableHead>
                        <TableHead>Type of leads</TableHead>
                        <TableHead>Vendor</TableHead>
                        <SortHeader label="Status" k="lead_status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                        <TableHead className="w-24 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.map(l => (
                        <TableRow key={l.id} data-state={selected.has(l.id) ? 'selected' : undefined}>
                          <TableCell>
                            <Checkbox checked={selected.has(l.id)} onCheckedChange={(c) => toggleOne(l.id, !!c)} aria-label={`Select ${customerName(l)}`} />
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
                          <TableCell className="text-xs">{vehicleStr(l) || '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{l.source_label ?? '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{l.type_of_vehicle ?? '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{l.type_of_leads ?? '—'}</TableCell>
                          <TableCell>
                            <Select value={l.vendor_id ?? 'none'} onValueChange={v => updateVendor(l.id, v)}>
                              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">-- Unassigned --</SelectItem>
                                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select value={l.lead_status} onValueChange={v => updateStatus(l.id, v)}>
                              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {!l.sale_id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openLinkModal(l)}
                                  title="Link to a sale manually"
                                  aria-label="Link to sale"
                                >
                                  <Link2 className="h-4 w-4 text-blue-500" />
                                </Button>
                              )}
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
                                    <AlertDialogDescription>Permanently removes {customerName(l)}. Any sales attributed to it will be unlinked.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteOne(l.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
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

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-3">
                  <p className="text-xs text-muted-foreground">
                    Showing {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString()} of {totalCount.toLocaleString()} records
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || loading}>
                      <ChevronLeft className="h-4 w-4" /> Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || loading}>
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {/* ── Link to Sale Modal ─────────────────────────────────────────── */}
      <Dialog open={linkModalOpen} onOpenChange={o => { if (!linking) setLinkModalOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Link Lead to Sale</DialogTitle>
            <DialogDescription>
              Search for a sale by customer name, VIN, stock#, or phone.
              Only unmatched sales are shown. This will mark the sale as manually attributed
              to <strong>{linkingLead?.customer_full_name ?? linkingLead?.customer_phone ?? 'this lead'}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <Input
              placeholder="Search customer name, VIN, stock #, phone..."
              value={saleSearch}
              onChange={e => searchSales(e.target.value)}
              autoFocus
            />

            {saleSearching && <p className="text-xs text-muted-foreground">Searching...</p>}

            {!saleSearching && saleSearch.trim().length >= 2 && saleResults.length === 0 && (
              <p className="text-xs text-muted-foreground">No unmatched sales found for "{saleSearch}".</p>
            )}

            {saleResults.length > 0 && (
              <div className="max-h-80 overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-2 text-left">Customer</th>
                      <th className="px-2 py-2 text-left">VIN</th>
                      <th className="px-2 py-2 text-left">Stock #</th>
                      <th className="px-2 py-2 text-left">Sale Date</th>
                      <th className="px-2 py-2 text-right">Price</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {saleResults.map(s => (
                      <tr key={s.id} className="border-t hover:bg-muted/30">
                        <td className="px-2 py-2 font-medium">{s.customer_full_name ?? '—'}</td>
                        <td className="px-2 py-2 font-mono text-muted-foreground">{s.vin ?? '—'}</td>
                        <td className="px-2 py-2 text-muted-foreground">{s.stock_number ?? '—'}</td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {s.sale_price ? `$${Number(s.sale_price).toLocaleString()}` : '—'}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button size="sm" disabled={linking} onClick={() => linkToSale(s)}>
                            {linking ? 'Linking...' : 'Link'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkModalOpen(false)} disabled={linking}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
