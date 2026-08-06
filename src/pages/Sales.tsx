import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Pencil, Trash2, Download, Search, X, ArrowUp, ArrowDown, ArrowUpDown, Upload, CalendarX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { downloadCsv } from '@/lib/exportCsv';
import { normalizePhone, normalizeEmail } from '@/lib/normalize';
import { toast } from 'sonner';

interface Sale {
  id: string;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  vin: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_of_interest: string | null;
  stock_number: string | null;
  sale_date: string | null;
  sale_price: number | null;
  front_gross: number | null;
  back_gross: number | null;
  total_gross: number | null;
  gross_revenue: number | null;
  salesperson: string | null;
  source_label: string | null;
  attribution_status: string;
  vendor_id: string | null;
  lead_id: string | null;
  notes: string | null;
  // match_method persists HOW the sale was matched (VIN, Stock#, Phone+Name, etc.)
  // so it survives page refreshes without re-running Match Leads.
  match_method: string | null;
}

interface VendorOption { id: string; name: string }

const NO_VENDOR = '__none__';

const emptyForm = {
  customer_full_name: '',
  customer_email: '',
  customer_phone: '',
  vin: '',
  vehicle_year: '',
  vehicle_make: '',
  vehicle_model: '',
  stock_number: '',
  sale_date: '',
  sale_price: '',
  front_gross: '',
  back_gross: '',
  total_gross: '',
  salesperson: '',
  source_label: '',
  vendor_id: '',
  notes: '',
};

// ---------------------------------------------------------------------------
// WHY: Name matching helpers
//
// extractLastName: takes the last word of a name string as a normalized last
// name token. We use last name only (not full name) because:
//   • Sales records often have "JOHN SMITH" while leads have "John Smith"
//   • First names vary most (Bob/Robert, Bill/William, Liz/Elizabeth)
//   • Last name alone is a strong enough secondary check alongside phone/email
// We lowercase and strip non-alpha so punctuation/spacing never blocks a match.
//
// namesMatch: returns true if either name's last name token appears inside the
// other string. Contains-check (not equality) handles suffixes like
// "Smith Jr" vs "Smith". Minimum 2 chars avoids single-letter false positives.
// ---------------------------------------------------------------------------
function extractLastName(fullName: string | null): string {
  if (!fullName) return '';
  const parts = fullName.trim().toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

function namesMatch(nameA: string | null, nameB: string | null): boolean {
  const a = extractLastName(nameA);
  const b = extractLastName(nameB);
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

function SortHeader({
  label, k, sortKey, sortDir, onClick, align = 'left',
}: {
  label: string; k: keyof Sale; sortKey: keyof Sale; sortDir: 'asc' | 'desc';
  onClick: (k: keyof Sale) => void; align?: 'left' | 'right';
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === 'right' ? 'text-right' : ''}>
      <button type="button" onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : 'text-muted-foreground'} ${align === 'right' ? 'ml-auto' : ''}`}>
        {label}<Icon className="h-3 w-3" />
      </button>
    </TableHead>
  );
}

export default function SalesPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [sales, setSales] = useState<Sale[]>([]);
  const [vendorList, setVendorList] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [vinFilter, setVinFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState<string>('__all__');
  const [nameFilter, setNameFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Sale | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [sortKey, setSortKey] = useState<keyof Sale>('sale_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  interface MatchResult { customerName: string; matchMethod: string; vendorName: string | null }
  const [leadMatches, setLeadMatches] = useState<Map<string, MatchResult>>(new Map());
  const [matching, setMatching] = useState(false);

  const [dateDeleteOpen, setDateDeleteOpen] = useState(false);
  const [deleteRangeFrom, setDeleteRangeFrom] = useState('');
  const [deleteRangeTo, setDeleteRangeTo] = useState('');
  const [deleteRangeCount, setDeleteRangeCount] = useState<number | null>(null);
  const [dateDeleteConfirmOpen, setDateDeleteConfirmOpen] = useState(false);
  const [deletingByDate, setDeletingByDate] = useState(false);

  const vendorMap = useMemo(() => {
    const m = new Map<string, string>();
    vendorList.forEach(v => m.set(v.id, v.name));
    return m;
  }, [vendorList]);

  // WHY: On load, read match_method from DB so the badge shows "via Phone+Name"
  // etc. immediately — no need to re-run Match Leads. Older records without
  // match_method fall back gracefully to displaying 'Auto'.
  useEffect(() => {
    if (sales.length === 0) return;
    const result = new Map<string, MatchResult>();
    for (const sale of sales) {
      if (sale.vendor_id && (sale.attribution_status === 'auto' || sale.attribution_status === 'manual')) {
        result.set(sale.id, {
          customerName: sale.customer_full_name ?? 'Unknown',
          matchMethod: sale.attribution_status === 'manual'
            ? 'Manual'
            : (sale.match_method ?? 'Auto'),
          vendorName: vendorMap.get(sale.vendor_id) ?? null,
        });
      }
    }
    setLeadMatches(result);
  }, [sales, vendorMap]);

  const toggleSort = (key: keyof Sale) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  useEffect(() => {
    if (!activeOrgId) return;
    void load();
    void loadVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  async function loadVendors() {
    if (!activeOrgId) return;
    const { data, error } = await supabase
      .from('vendors').select('id, name').eq('organization_id', activeOrgId).order('name');
    if (!error) setVendorList((data ?? []) as VendorOption[]);
  }

  async function load() {
    if (!activeOrgId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('sales')
      .select(
        'id, customer_full_name, customer_email, customer_phone, vin, vehicle_year, vehicle_make, vehicle_model, vehicle_of_interest, stock_number, sale_date, sale_price, front_gross, back_gross, total_gross, gross_revenue, salesperson, source_label, attribution_status, vendor_id, lead_id, notes, match_method',
      )
      .eq('organization_id', activeOrgId)
      .order('sale_date', { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) {
      toast.error('Failed to load sales', { description: error.message });
    } else {
      setSales((data ?? []) as Sale[]);
      setSelected(new Set());
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const v = vinFilter.trim().toLowerCase();
    const n = nameFilter.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    return sales.filter(sale => {
      if (vendorFilter !== '__all__') {
        if (vendorFilter === '__none__') { if (sale.vendor_id) return false; }
        else if (sale.vendor_id !== vendorFilter) return false;
      }
      if (v && !(sale.vin ?? '').toLowerCase().includes(v)) return false;
      if (n && !(sale.customer_full_name ?? '').toLowerCase().includes(n)) return false;
      if (from || to) {
        if (!sale.sale_date) return false;
        const t = new Date(sale.sale_date).getTime();
        if (from && t < from) return false;
        if (to && t > to) return false;
      }
      if (s) {
        const hay = [
          sale.customer_full_name, sale.customer_email, sale.customer_phone,
          sale.vin, sale.stock_number, sale.salesperson, sale.source_label,
          sale.vehicle_make, sale.vehicle_model, sale.vehicle_of_interest,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [sales, search, vinFilter, nameFilter, dateFrom, dateTo, vendorFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sortKey === 'sale_date')
        return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * dir;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const allOnPageSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allOnPageSelected) filtered.forEach(s => next.delete(s.id));
    else filtered.forEach(s => next.add(s.id));
    setSelected(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const clearFilters = () => {
    setSearch(''); setVinFilter(''); setNameFilter('');
    setDateFrom(''); setDateTo(''); setVendorFilter('__all__');
  };

  const openEdit = (sale: Sale) => {
    setEditing(sale);
    setForm({
      customer_full_name: sale.customer_full_name ?? '',
      customer_email: sale.customer_email ?? '',
      customer_phone: sale.customer_phone ?? '',
      vin: sale.vin ?? '',
      vehicle_year: sale.vehicle_year != null ? String(sale.vehicle_year) : '',
      vehicle_make: sale.vehicle_make ?? '',
      vehicle_model: sale.vehicle_model ?? '',
      stock_number: sale.stock_number ?? '',
      sale_date: sale.sale_date ? sale.sale_date.slice(0, 10) : '',
      sale_price: sale.sale_price != null ? String(sale.sale_price) : '',
      front_gross: sale.front_gross != null ? String(sale.front_gross) : '',
      back_gross: sale.back_gross != null ? String(sale.back_gross) : '',
      total_gross: sale.total_gross != null ? String(sale.total_gross) : '',
      salesperson: sale.salesperson ?? '',
      source_label: sale.source_label ?? '',
      vendor_id: sale.vendor_id ?? '',
      notes: sale.notes ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const newVendorId = form.vendor_id ? form.vendor_id : null;
    const vendorChanged = (editing.vendor_id ?? null) !== newVendorId;
    const payload: any = {
      customer_full_name: form.customer_full_name || null,
      customer_email: form.customer_email || null,
      customer_phone: form.customer_phone || null,
      vin: form.vin || null,
      vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : null,
      vehicle_make: form.vehicle_make || null,
      vehicle_model: form.vehicle_model || null,
      stock_number: form.stock_number || null,
      sale_date: form.sale_date ? new Date(form.sale_date).toISOString() : null,
      sale_price: form.sale_price ? Number(form.sale_price) : null,
      front_gross: form.front_gross ? Number(form.front_gross) : null,
      back_gross: form.back_gross ? Number(form.back_gross) : null,
      total_gross: form.total_gross ? Number(form.total_gross) : null,
      salesperson: form.salesperson || null,
      source_label: form.source_label || null,
      vendor_id: newVendorId,
      notes: form.notes || null,
      manual_override: true,
    };
    if (vendorChanged) {
      payload.attribution_status = newVendorId ? 'manual' : 'none';
      payload.attribution_confidence = 100;
    }
    const { error } = await supabase.from('sales').update(payload).eq('id', editing.id);
    if (error) { toast.error('Update failed', { description: error.message }); return; }
    toast.success('Sale updated');
    setEditing(null);
    void load();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from('sales').delete().in('id', confirmDelete.ids);
    if (error) { toast.error('Delete failed', { description: error.message }); }
    else { toast.success(`Deleted ${confirmDelete.ids.length} sale(s)`); }
    setConfirmDelete(null);
    void load();
  };

  const previewDateRangeCount = async () => {
    if (!activeOrgId || !deleteRangeFrom || !deleteRangeTo) return;
    const fromIso = new Date(deleteRangeFrom).toISOString();
    const toIso = new Date(new Date(deleteRangeTo).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
    const { count, error } = await supabase.from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', activeOrgId)
      .gte('sale_date', fromIso).lte('sale_date', toIso);
    if (error) { toast.error('Could not count records', { description: error.message }); return; }
    setDeleteRangeCount(count ?? 0);
    setDateDeleteOpen(false);
    setDateDeleteConfirmOpen(true);
  };

  const doDateRangeDelete = async () => {
    if (!activeOrgId || !deleteRangeFrom || !deleteRangeTo) return;
    setDeletingByDate(true);
    const fromIso = new Date(deleteRangeFrom).toISOString();
    const toIso = new Date(new Date(deleteRangeTo).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
    const { error } = await supabase.from('sales').delete()
      .eq('organization_id', activeOrgId)
      .gte('sale_date', fromIso).lte('sale_date', toIso);
    setDeletingByDate(false);
    if (error) { toast.error('Delete failed', { description: error.message }); }
    else {
      toast.success(`Deleted ${deleteRangeCount ?? 'matching'} sale(s) between ${deleteRangeFrom} and ${deleteRangeTo}`);
      setDateDeleteConfirmOpen(false);
      setDeleteRangeFrom(''); setDeleteRangeTo(''); setDeleteRangeCount(null);
      void load();
    }
  };

  // ---------------------------------------------------------------------------
  // matchLeads — confidence waterfall (highest → lowest):
  //
  //  1. VIN          100%  unique vehicle ID, most reliable
  //  2. Stock#        95%  dealership stock number, very reliable
  //  3. Phone+Name    90%  phone + last-name match eliminates shared-phone risk
  //  4. Email+Name    90%  email + last-name match, same logic
  //  5. Email+Phone   88%  two independent contact fields agree (no name needed)
  //  6. Phone alone   75%  single-field fallback, only when exactly 1 lead matches
  //  7. Email alone   75%  single-field fallback, only when exactly 1 lead matches
  //
  // WHY Phone/Email maps hold arrays: unlike VIN/Stock# (unique per vehicle),
  // a phone or email can appear on multiple leads. Arrays let combo checks
  // scan all candidates for name or second-field agreement.
  //
  // WHY "exactly 1" guard on solo Phone/Email fallback: if multiple leads share
  // the same phone or email we cannot confidently pick one, so we skip rather
  // than risk a wrong attribution.
  //
  // WHY vehicle-conflict filtering on tiers 3-7: a repeat/fleet buyer (same
  // phone or email) can submit one lead and then buy many unrelated vehicles.
  // If the sale has its own VIN/Stock# and it doesn't match a candidate
  // lead's VIN/Stock#, that candidate is provably the wrong vehicle — drop it
  // before doing name/uniqueness checks, even though tiers 3-7 don't require
  // VIN/Stock# to match, they must not contradict.
  //
  // WHY one-sale cap on vehicle-less leads (tiers 3-7 only, when the matched
  // lead has no VIN and no Stock# at all): with zero vehicle evidence, phone/
  // email is the ONLY signal, and a repeat/fleet account can generate many
  // unrelated sales on the same phone/email over months. Letting one generic
  // lead claim every one of those sales is exactly as wrong as a VIN
  // conflict, just without a VIN to prove it. So such a lead is only allowed
  // to claim the single closest-dated sale (by |sale_date - lead_date|); the
  // rest are left unmatched for manual review.
  // ---------------------------------------------------------------------------
  const matchLeads = async () => {
    if (!activeOrgId) return;
    setMatching(true);

    const { data: leadsData } = await supabase
      .from('leads')
      .select('id, customer_full_name, customer_email, customer_phone, normalized_phone, normalized_email, vendor_id, vin, stock_number, lead_date')
      .eq('organization_id', activeOrgId);

    type LeadEntry = {
      leadId: string; name: string; vendorId: string | null;
      normPhone: string; normEmail: string;
      vin: string; stock: string;
      leadDateMs: number | null;
    };

    const vinMap   = new Map<string, LeadEntry>();
    const stockMap = new Map<string, LeadEntry>();
    const phoneMap = new Map<string, LeadEntry[]>();
    const emailMap = new Map<string, LeadEntry[]>();

    for (const lead of leadsData ?? []) {
      const normPhone = lead.normalized_phone || normalizePhone(lead.customer_phone);
      const normEmail = lead.normalized_email || normalizeEmail(lead.customer_email);
      const entry: LeadEntry = {
        leadId: lead.id,
        name: lead.customer_full_name ?? '',
        vendorId: lead.vendor_id ?? null,
        normPhone,
        normEmail,
        vin: (lead.vin ?? '').trim().toUpperCase(),
        stock: (lead.stock_number ?? '').trim().toUpperCase(),
        leadDateMs: lead.lead_date ? new Date(lead.lead_date).getTime() : null,
      };
      if (lead.vin) {
        const key = lead.vin.trim().toUpperCase();
        if (key && !vinMap.has(key)) vinMap.set(key, entry);
      }
      if (lead.stock_number) {
        const key = lead.stock_number.trim().toUpperCase();
        if (key && !stockMap.has(key)) stockMap.set(key, entry);
      }
      if (normPhone) {
        if (!phoneMap.has(normPhone)) phoneMap.set(normPhone, []);
        phoneMap.get(normPhone)!.push(entry);
      }
      if (normEmail) {
        if (!emailMap.has(normEmail)) emailMap.set(normEmail, []);
        emailMap.get(normEmail)!.push(entry);
      }
    }

    // Find first candidate whose last name matches the sale's customer name
    const findByName = (candidates: LeadEntry[], saleName: string | null): LeadEntry | null =>
      candidates.find(c => namesMatch(c.name, saleName)) ?? null;

    // Drop candidates whose VIN/Stock# actively contradicts the sale's own
    // VIN/Stock# — a repeat buyer's phone/email can match many leads, but a
    // mismatched vehicle identifier proves it's the wrong one.
    const dropVehicleConflicts = (candidates: LeadEntry[], saleVin: string, saleStock: string): LeadEntry[] =>
      candidates.filter(c =>
        !(saleVin && c.vin && c.vin !== saleVin) &&
        !(saleStock && c.stock && c.stock !== saleStock),
      );

    const result = new Map<string, MatchResult>();
    type SaleUpdate = {
      id: string; vendor_id: string | null; lead_id: string;
      confidence: number; assignVendor: boolean; method: string;
    };
    const updates: SaleUpdate[] = [];

    const finalize = (sale: Sale, matched: LeadEntry, method: string, confidence: number) => {
      result.set(sale.id, {
        customerName: matched.name || (sale.customer_full_name ?? 'Unknown'),
        matchMethod: method,
        vendorName: matched.vendorId ? vendorMap.get(matched.vendorId) ?? null : null,
      });
      updates.push({
        id: sale.id,
        lead_id: matched.leadId,
        vendor_id: matched.vendorId && !sale.vendor_id ? matched.vendorId : (sale.vendor_id ?? null),
        confidence,
        assignVendor: !!(matched.vendorId && !sale.vendor_id),
        method,
      });
    };

    // Vehicle-less matches (tiers 3-7, lead has no VIN/Stock#) are held back
    // per lead until every sale has been scanned, so we can pick only the
    // closest-dated one per lead instead of claiming all of them.
    type PendingVehicleLess = { sale: Sale; matched: LeadEntry; method: string; confidence: number; diffMs: number };
    const vehicleLessByLead = new Map<string, PendingVehicleLess[]>();

    for (const sale of sales) {
      if (sale.attribution_status === 'manual') continue;

      let matched: LeadEntry | null = null;
      let method = '';
      let confidence = 0;

      const saleVin   = sale.vin?.trim().toUpperCase() ?? '';
      const saleStock = sale.stock_number?.trim().toUpperCase() ?? '';
      const salePhone = normalizePhone(sale.customer_phone);
      const saleEmail = normalizeEmail(sale.customer_email);

      // 1. VIN
      if (saleVin) {
        const hit = vinMap.get(saleVin);
        if (hit) { matched = hit; method = 'VIN'; confidence = 100; }
      }

      // 2. Stock#
      if (!matched && saleStock) {
        const hit = stockMap.get(saleStock);
        if (hit) { matched = hit; method = 'Stock#'; confidence = 95; }
      }

      // 3. Phone + Name
      if (!matched && salePhone) {
        const candidates = dropVehicleConflicts(phoneMap.get(salePhone) ?? [], saleVin, saleStock);
        const hit = findByName(candidates, sale.customer_full_name);
        if (hit) { matched = hit; method = 'Phone+Name'; confidence = 90; }
      }

      // 4. Email + Name
      if (!matched && saleEmail) {
        const candidates = dropVehicleConflicts(emailMap.get(saleEmail) ?? [], saleVin, saleStock);
        const hit = findByName(candidates, sale.customer_full_name);
        if (hit) { matched = hit; method = 'Email+Name'; confidence = 90; }
      }

      // 5. Email + Phone (same lead has both, no name needed)
      if (!matched && salePhone && saleEmail) {
        const candidates = dropVehicleConflicts(phoneMap.get(salePhone) ?? [], saleVin, saleStock);
        const hit = candidates.find(c => c.normEmail === saleEmail) ?? null;
        if (hit) { matched = hit; method = 'Email+Phone'; confidence = 88; }
      }

      // 6. Phone alone — only if exactly 1 non-conflicting lead has this phone
      if (!matched && salePhone) {
        const candidates = dropVehicleConflicts(phoneMap.get(salePhone) ?? [], saleVin, saleStock);
        if (candidates.length === 1) {
          matched = candidates[0]; method = 'Phone'; confidence = 75;
        }
      }

      // 7. Email alone — only if exactly 1 non-conflicting lead has this email
      if (!matched && saleEmail) {
        const candidates = dropVehicleConflicts(emailMap.get(saleEmail) ?? [], saleVin, saleStock);
        if (candidates.length === 1) {
          matched = candidates[0]; method = 'Email'; confidence = 75;
        }
      }

      if (matched) {
        const isVehicleLess = (method === 'Phone+Name' || method === 'Email+Name' || method === 'Email+Phone' || method === 'Phone' || method === 'Email')
          && !matched.vin && !matched.stock;

        if (isVehicleLess) {
          const saleMs = sale.sale_date ? new Date(sale.sale_date).getTime() : null;
          const diffMs = (saleMs !== null && matched.leadDateMs !== null)
            ? Math.abs(saleMs - matched.leadDateMs)
            : Number.POSITIVE_INFINITY;
          const arr = vehicleLessByLead.get(matched.leadId) ?? [];
          arr.push({ sale, matched, method, confidence, diffMs });
          vehicleLessByLead.set(matched.leadId, arr);
        } else {
          finalize(sale, matched, method, confidence);
        }
      }
    }

    // Resolve each vehicle-less lead's candidate sales down to a single
    // closest-dated winner; the rest stay unmatched.
    for (const candidates of vehicleLessByLead.values()) {
      const winner = candidates.reduce((best, c) => (c.diffMs < best.diffMs ? c : best));
      finalize(winner.sale, winner.matched, winner.method, winner.confidence);
    }

    setLeadMatches(result);

    if (updates.length > 0) {
      await Promise.all(
        updates.map(u => {
          const payload: any = {
            lead_id: u.lead_id,
            attribution_status: 'auto',
            attribution_confidence: u.confidence,
            match_method: u.method,
          };
          if (u.assignVendor) payload.vendor_id = u.vendor_id;
          return supabase.from('sales').update(payload).eq('id', u.id);
        }),
      );
      void load();
    }

    setMatching(false);
    const matchCount = result.size;
    toast.success(
      updates.length > 0
        ? `Matched ${matchCount} of ${sales.length} sales · vendor assigned to ${updates.length}`
        : `Matched ${matchCount} of ${sales.length} sales to leads`
    );
  };

  const exportCsv = () => {
    const rows = filtered.map(s => ({
      sale_date: s.sale_date ?? '',
      customer_full_name: s.customer_full_name ?? '',
      customer_email: s.customer_email ?? '',
      customer_phone: s.customer_phone ?? '',
      vin: s.vin ?? '',
      vehicle: [s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' '),
      stock_number: s.stock_number ?? '',
      sale_price: s.sale_price ?? '',
      front_gross: s.front_gross ?? '',
      back_gross: s.back_gross ?? '',
      total_gross: s.total_gross ?? '',
      salesperson: s.salesperson ?? '',
      source_label: s.source_label ?? '',
      vendor: s.vendor_id ? vendorMap.get(s.vendor_id) ?? '' : '',
      attribution_status: s.attribution_status,
      match_method: s.match_method ?? '',
    }));
    downloadCsv(`sales-${activeOrg?.name ?? 'export'}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const fmtCurrency = (n: number | null) =>
    n == null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '');
  const vehicleStr = (s: Sale) =>
    [s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ') || s.vehicle_of_interest || '';

  if (!activeOrgId) {
    return <div className="text-sm text-muted-foreground">Select a dealership to view sales.</div>;
  }

  const filtersActive = !!(search || vinFilter || nameFilter || dateFrom || dateTo) || vendorFilter !== '__all__';
  const matchRate = sales.length > 0 ? Math.round(leadMatches.size / sales.length * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales</h1>
          <p className="text-sm text-muted-foreground">
            {activeOrg?.name} · {filtered.length} of {sales.length} shown
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={matchLeads} disabled={matching || sales.length === 0}>
            {matching ? 'Matching…' : 'Match Leads'}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/sales/upload"><Upload className="mr-2 h-4 w-4" /> Upload sales</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button
            variant="outline" size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => { setDeleteRangeFrom(''); setDeleteRangeTo(''); setDeleteRangeCount(null); setDateDeleteOpen(true); }}
            disabled={sales.length === 0}
          >
            <CalendarX className="mr-2 h-4 w-4" /> Delete by date
          </Button>
        </div>
      </div>

      {sales.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-md border border-border bg-muted px-3 py-1.5 font-medium text-foreground">
            {leadMatches.size.toLocaleString()} of {sales.length.toLocaleString()} matched
          </span>
          <span className="text-muted-foreground">{matchRate}% match rate</span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div>
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Anything..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input placeholder="Customer name" value={nameFilter} onChange={e => setNameFilter(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">VIN</Label>
              <Input placeholder="VIN contains..." value={vinFilter} onChange={e => setVinFilter(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Vendor</Label>
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All vendors</SelectItem>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {vendorList.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sold from</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Sold to</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 h-3 w-3" /> Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-4 py-2">
          <span className="text-sm">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete({ ids: Array.from(selected), label: `${selected.size} sale(s)` })}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete selected
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">All Sales</CardTitle>
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-md border border-border bg-muted px-2 py-1 font-medium text-foreground">
                {filtered.length.toLocaleString()} {filtered.length === 1 ? 'record' : 'records'}
              </span>
              {filtered.length !== sales.length && (
                <span className="text-muted-foreground">of {sales.length.toLocaleString()} total</span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="[&>div]:max-h-[calc(100vh-380px)] [&>div]:min-h-[300px] [&>div]:overflow-auto">
            <Table className="min-w-[1400px]">
              <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                  </TableHead>
                  <SortHeader label="Sale date" k="sale_date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortHeader label="Customer" k="customer_full_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortHeader label="VIN" k="vin" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortHeader label="Vehicle" k="vehicle_make" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortHeader label="Stock #" k="stock_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortHeader label="Price" k="sale_price" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortHeader label="Total gross" k="total_gross" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortHeader label="Salesperson" k="salesperson" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortHeader label="Vendor" k="vendor_id" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortHeader label="Status" k="attribution_status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortHeader label="Lead Match" k="lead_id" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={13} className="text-center text-sm text-muted-foreground">Loading sales...</TableCell></TableRow>
                ) : sorted.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="text-center text-sm text-muted-foreground">
                    {sales.length === 0 ? 'No sales yet. Upload a sales file to begin.' : 'No sales match your filters.'}
                  </TableCell></TableRow>
                ) : sorted.map(sale => (
                  <TableRow key={sale.id} data-state={selected.has(sale.id) ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox checked={selected.has(sale.id)} onCheckedChange={() => toggleOne(sale.id)} aria-label={`Select sale ${sale.id}`} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(sale.sale_date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{sale.customer_full_name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{sale.customer_email ?? sale.customer_phone ?? ''}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{sale.vin ?? '—'}</TableCell>
                    <TableCell>{vehicleStr(sale) || '—'}</TableCell>
                    <TableCell>{sale.stock_number ?? '—'}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(sale.sale_price)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(sale.total_gross ?? sale.gross_revenue)}</TableCell>
                    <TableCell>{sale.salesperson ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {sale.vendor_id
                        ? vendorMap.get(sale.vendor_id) ?? <span className="text-muted-foreground italic">unknown</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sale.attribution_status === 'auto' ? 'default' : sale.attribution_status === 'manual' ? 'secondary' : 'outline'}>
                        {sale.attribution_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {(() => {
                        const m = leadMatches.get(sale.id);
                        if (!m) return <span className="text-muted-foreground">— No match</span>;
                        return (
                          <div className="space-y-0.5">
                            <div className="font-medium text-green-600 truncate max-w-[140px]">{m.customerName}</div>
                            <Badge variant="outline" className="text-[10px] px-1 py-0">via {m.matchMethod}</Badge>
                            {m.vendorName && <div className="text-xs text-muted-foreground truncate max-w-[140px]">{m.vendorName}</div>}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(sale)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmDelete({ ids: [sale.id], label: sale.customer_full_name ?? 'this sale' })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Edit dialog ───────────────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Edit sale</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><Label>Customer name</Label>
              <Input value={form.customer_full_name} onChange={e => setForm({ ...form, customer_full_name: e.target.value })} /></div>
            <div><Label>Email</Label><Input value={form.customer_email} onChange={e => setForm({ ...form, customer_email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} /></div>
            <div><Label>VIN</Label><Input value={form.vin} onChange={e => setForm({ ...form, vin: e.target.value })} /></div>
            <div><Label>Stock #</Label><Input value={form.stock_number} onChange={e => setForm({ ...form, stock_number: e.target.value })} /></div>
            <div><Label>Year</Label><Input type="number" value={form.vehicle_year} onChange={e => setForm({ ...form, vehicle_year: e.target.value })} /></div>
            <div><Label>Make</Label><Input value={form.vehicle_make} onChange={e => setForm({ ...form, vehicle_make: e.target.value })} /></div>
            <div><Label>Model</Label><Input value={form.vehicle_model} onChange={e => setForm({ ...form, vehicle_model: e.target.value })} /></div>
            <div><Label>Sale date</Label><Input type="date" value={form.sale_date} onChange={e => setForm({ ...form, sale_date: e.target.value })} /></div>
            <div><Label>Sale price</Label><Input type="number" step="0.01" value={form.sale_price} onChange={e => setForm({ ...form, sale_price: e.target.value })} /></div>
            <div><Label>Front gross</Label><Input type="number" step="0.01" value={form.front_gross} onChange={e => setForm({ ...form, front_gross: e.target.value })} /></div>
            <div><Label>Back gross</Label><Input type="number" step="0.01" value={form.back_gross} onChange={e => setForm({ ...form, back_gross: e.target.value })} /></div>
            <div><Label>Total gross</Label><Input type="number" step="0.01" value={form.total_gross} onChange={e => setForm({ ...form, total_gross: e.target.value })} /></div>
            <div><Label>Salesperson</Label><Input value={form.salesperson} onChange={e => setForm({ ...form, salesperson: e.target.value })} /></div>
            <div><Label>Source</Label><Input value={form.source_label} onChange={e => setForm({ ...form, source_label: e.target.value })} /></div>
            <div>
              <Label>Vendor</Label>
              <Select value={form.vendor_id || NO_VENDOR} onValueChange={v => setForm({ ...form, vendor_id: v === NO_VENDOR ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VENDOR}>— None —</SelectItem>
                  {vendorList.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Row/selection delete confirmation ─────────────────────────────── */}
      <AlertDialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sale(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently delete {confirmDelete?.label}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Date-range delete: pick dates ─────────────────────────────────── */}
      <Dialog open={dateDeleteOpen} onOpenChange={setDateDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete sales by date range</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Permanently delete all sales whose <strong>sale date</strong> falls within the range below.
            You will see a count before confirming.
          </p>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div><Label>From date</Label><Input type="date" value={deleteRangeFrom} onChange={e => setDeleteRangeFrom(e.target.value)} /></div>
            <div><Label>To date</Label><Input type="date" value={deleteRangeTo} onChange={e => setDeleteRangeTo(e.target.value)} /></div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDateDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive"
              disabled={!deleteRangeFrom || !deleteRangeTo || deleteRangeFrom > deleteRangeTo}
              onClick={previewDateRangeCount}>
              Preview &amp; confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Date-range delete: final confirmation with count ──────────────── */}
      <AlertDialog open={dateDeleteConfirmOpen} onOpenChange={open => !open && setDateDeleteConfirmOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteRangeCount ?? '…'} sales?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{' '}
              <strong>{deleteRangeCount ?? '…'} sale record{deleteRangeCount !== 1 ? 's' : ''}</strong>{' '}
              with a sale date between <strong>{deleteRangeFrom}</strong> and <strong>{deleteRangeTo}</strong>.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDateDeleteConfirmOpen(false); setDateDeleteOpen(true); }}>Back</AlertDialogCancel>
            <AlertDialogAction onClick={doDateRangeDelete} disabled={deletingByDate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingByDate ? 'Deleting…' : `Delete ${deleteRangeCount ?? ''} record${deleteRangeCount !== 1 ? 's' : ''}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
