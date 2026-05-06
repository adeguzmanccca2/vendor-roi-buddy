import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Wand2, TrendingUp, TrendingDown, Minus, DollarSign, ShoppingCart, Target, Download, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, Cell,
} from 'recharts';
import { AttributionOverrideDialog } from '@/components/AttributionOverrideDialog';
import { downloadCsv } from '@/lib/exportCsv';

interface Vendor { id: string; name: string; monthly_cost: number | null }
interface SaleRow {
  id: string; vendor_id: string | null; lead_id: string | null;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  organization_id: string;
  sale_date: string | null;
  sale_price: number | null;
  total_gross: number | null; gross_revenue: number | null;
  attribution_status: string; attribution_confidence: number | null;
  manual_override: boolean;
  vehicle_year: number | null; vehicle_make: string | null; vehicle_model: string | null;
  stock_number: string | null; deal_number: string | null;
  vin: string | null;
}
interface LeadRow {
  id: string;
  vendor_id: string | null;
  lead_date: string | null;
  created_at: string;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vin: string | null;
  stock_number: string | null;
  source_label: string | null;
  lead_status: string;
}

// Single source of truth for "what counts as revenue from a sale".
// Per project rule: ROI uses front + back gross (true dealer profit),
// not sticker/sale price. Falls back to gross_revenue, then 0.
function saleRevenue(s: { total_gross?: number | null; gross_revenue?: number | null }): number {
  const tg = Number(s.total_gross ?? 0);
  if (tg) return tg;
  return Number(s.gross_revenue ?? 0);
}

interface VendorPerf {
  vendor: Vendor | null;
  vendorName: string;
  leads: number;
  sales: number;
  revenue: number;
  cost: number;
  cpl: number;
  cpa: number;
  closeRate: number;
  roi: number;
  category: 'CUT' | 'OPTIMIZE' | 'SCALE' | 'NONE';
}

function classify(roi: number, cost: number): VendorPerf['category'] {
  if (cost <= 0) return 'NONE';
  if (roi < 0) return 'CUT';
  if (roi <= 1) return 'OPTIMIZE';
  return 'SCALE';
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

type Period = `m:${string}`;

function isMonthPeriod(p: Period): p is `m:${string}` {
  return typeof p === 'string' && p.startsWith('m:');
}

function currentMonthPeriod(): Period {
  const d = new Date();
  return `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodRange(p: Period): { start: string | null; end: string | null } {
  if (isMonthPeriod(p)) {
    const [y, m] = p.slice(2).split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1); // first day of next month, exclusive
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return { start: null, end: null };
}

function periodMonths(_p: Period): number {
  return 1;
}

function monthOptions(count = 24): { value: `m:${string}`; label: string }[] {
  const now = new Date();
  const out: { value: `m:${string}`; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` as const;
    const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    out.push({ value, label });
  }
  return out;
}

const CAT_COLOR: Record<VendorPerf['category'], string> = {
  CUT: 'hsl(var(--destructive))',
  OPTIMIZE: 'hsl(var(--muted-foreground))',
  SCALE: 'hsl(142 71% 45%)',
  NONE: 'hsl(var(--border))',
};

export default function AttributionPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
  const [unattributedLeads, setUnattributedLeads] = useState<number>(0);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [trendSales, setTrendSales] = useState<{ sale_date: string | null; sale_price: number | null; total_gross: number | null; gross_revenue: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [period, setPeriod] = useState<Period>(currentMonthPeriod());
  const [overrideSale, setOverrideSale] = useState<SaleRow | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [vendorSalesView, setVendorSalesView] = useState<{ id: string | null; name: string } | null>(null);
  const [vendorLeadsView, setVendorLeadsView] = useState<{ id: string | null; name: string } | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    const { start: sinceIso, end: untilIso } = periodRange(period);
    const trendSinceIso = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1).toISOString();

    const vQ = supabase.from('vendors').select('id, name, monthly_cost')
      .eq('organization_id', activeOrgId).order('name');
    let lQ = supabase.from('leads').select('id, vendor_id, lead_date, created_at, customer_full_name, customer_email, customer_phone, vehicle_year, vehicle_make, vehicle_model, vin, stock_number, source_label, lead_status')
      .eq('organization_id', activeOrgId)
      .order('lead_date', { ascending: false });
    // Bucket leads with no lead_date by created_at — otherwise they're invisible.
    if (sinceIso && untilIso) {
      lQ = lQ.or(
        `and(lead_date.gte.${sinceIso},lead_date.lt.${untilIso}),` +
        `and(lead_date.is.null,created_at.gte.${sinceIso},created_at.lt.${untilIso})`,
      );
    }
    let sQ = supabase.from('sales').select('id, vendor_id, lead_id, customer_full_name, customer_email, customer_phone, normalized_email, normalized_phone, organization_id, sale_date, sale_price, total_gross, gross_revenue, attribution_status, attribution_confidence, manual_override, vehicle_year, vehicle_make, vehicle_model, stock_number, deal_number, vin')
      .eq('organization_id', activeOrgId)
      .order('sale_date', { ascending: false });
    if (sinceIso) sQ = sQ.gte('sale_date', sinceIso);
    if (untilIso) sQ = sQ.lt('sale_date', untilIso);

    const tQ = supabase.from('sales').select('sale_date, sale_price, total_gross, gross_revenue')
      .eq('organization_id', activeOrgId)
      .gte('sale_date', trendSinceIso);

    const [{ data: vData }, { data: lData }, { data: sData }, { data: tData }] = await Promise.all([vQ, lQ, sQ, tQ]);
    setVendors((vData ?? []) as Vendor[]);
    const leadRows = (lData ?? []) as LeadRow[];
    setLeads(leadRows);
    const counts: Record<string, number> = {};
    let unassigned = 0;
    for (const l of leadRows) {
      if (!l.vendor_id) { unassigned++; continue; }
      counts[l.vendor_id] = (counts[l.vendor_id] ?? 0) + 1;
    }
    setLeadCounts(counts);
    setUnattributedLeads(unassigned);
    setSales((sData ?? []) as SaleRow[]);
    setTrendSales((tData ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeOrgId, period]);

  const months = periodMonths(period);

  const perf: VendorPerf[] = useMemo(() => {
    const knownVendorIds = new Set(vendors.map(v => v.id));

    // VIN → vendor_ids from leads (secondary match)
    const vinToVendors = new Map<string, Set<string>>();
    for (const l of leads) {
      if (!l.vin || !l.vendor_id) continue;
      const key = l.vin.trim().toUpperCase();
      if (!key) continue;
      const set = vinToVendors.get(key) ?? new Set<string>();
      set.add(l.vendor_id);
      vinToVendors.set(key, set);
    }

    // stock_number → vendor_ids from leads (tertiary match)
    const stockToVendors = new Map<string, Set<string>>();
    for (const l of leads) {
      if (!l.stock_number || !l.vendor_id) continue;
      const key = l.stock_number.trim().toUpperCase();
      if (!key) continue;
      const set = stockToVendors.get(key) ?? new Set<string>();
      set.add(l.vendor_id);
      stockToVendors.set(key, set);
    }

    const byVendor = new Map<string | null, { revenue: number; sales: number }>();

    const credit = (vendorId: string | null, sale: SaleRow) => {
      const key = vendorId && knownVendorIds.has(vendorId) ? vendorId : null;
      const cur = byVendor.get(key) ?? { revenue: 0, sales: 0 };
      cur.revenue += saleRevenue(sale);
      cur.sales += 1;
      byVendor.set(key, cur);
    };

    for (const s of sales) {
      // Priority 1: vendor_id match — covers manual overrides and auto-attributed sales
      if (s.vendor_id && knownVendorIds.has(s.vendor_id)) {
        credit(s.vendor_id, s);
        continue;
      }

      // Priority 2: VIN match against lead VINs
      const vin = s.vin ? s.vin.trim().toUpperCase() : '';
      const vinVendors = vin ? vinToVendors.get(vin) : undefined;
      if (vinVendors && vinVendors.size > 0) {
        for (const vid of vinVendors) credit(vid, s);
        continue;
      }

      // Priority 3: stock_number match against lead stock numbers
      const stock = s.stock_number ? s.stock_number.trim().toUpperCase() : '';
      const stockVendors = stock ? stockToVendors.get(stock) : undefined;
      if (stockVendors && stockVendors.size > 0) {
        for (const vid of stockVendors) credit(vid, s);
        continue;
      }

      // No match — unassigned bucket
      credit(null, s);
    }
    const rows: VendorPerf[] = vendors.map(v => {
      const agg = byVendor.get(v.id) ?? { revenue: 0, sales: 0 };
      const leads = leadCounts[v.id] ?? 0;
      const cost = Number(v.monthly_cost ?? 0) * months;
      const cpl = leads > 0 ? cost / leads : 0;
      const cpa = agg.sales > 0 ? cost / agg.sales : 0;
      const closeRate = leads > 0 ? agg.sales / leads : 0;
      const roi = cost > 0 ? (agg.revenue - cost) / cost : 0;
      return {
        vendor: v, vendorName: v.name, leads, sales: agg.sales, revenue: agg.revenue,
        cost, cpl, cpa, closeRate, roi, category: classify(roi, cost),
      };
    });
    const unassignedAgg = byVendor.get(null);
    if (unassignedAgg || unattributedLeads > 0) {
      rows.push({
        vendor: null, vendorName: 'Unassigned',
        leads: unattributedLeads,
        sales: unassignedAgg?.sales ?? 0,
        revenue: unassignedAgg?.revenue ?? 0,
        cost: 0, cpl: 0, cpa: 0,
        closeRate: unattributedLeads > 0 ? (unassignedAgg?.sales ?? 0) / unattributedLeads : 0,
        roi: 0, category: 'NONE',
      });
    }
    return rows.sort((a, b) => b.revenue - a.revenue);
  }, [vendors, sales, leads, leadCounts, unattributedLeads, months]);

  const totals = useMemo(() => {
    // Top-line uses raw sales array — guarantees orphan vendor_ids still count.
    const revenue = sales.reduce((a, s) => a + saleRevenue(s), 0);
    const salesCount = sales.length;
    const cost = perf.reduce((a, r) => a + r.cost, 0);
    const leads = perf.reduce((a, r) => a + r.leads, 0);
    return {
      revenue,
      sales: salesCount,
      cost,
      leads,
      roi: cost > 0 ? (revenue - cost) / cost : 0,
    };
  }, [sales, perf]);

  // 12-month revenue trend
  const trend = useMemo(() => {
    const buckets: Record<string, number> = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = 0;
    }
    for (const s of trendSales) {
      if (!s.sale_date) continue;
      const d = new Date(s.sale_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in buckets) buckets[key] += saleRevenue(s);
    }
    return Object.entries(buckets).map(([month, revenue]) => ({
      month: month.slice(5) + '/' + month.slice(2, 4),
      revenue,
    }));
  }, [trendSales]);

  const roiChart = useMemo(() =>
    perf.filter(p => p.cost > 0).slice(0, 10).map(p => ({
      name: p.vendorName.length > 14 ? p.vendorName.slice(0, 14) + '…' : p.vendorName,
      roi: Math.round(p.roi * 100),
      category: p.category,
    })), [perf]);

  const runAttribution = async () => {
    if (!activeOrgId) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc('attribute_sales_for_org', { _org_id: activeOrgId });
      if (error) throw error;
      const r = Array.isArray(data) ? data[0] : data;
      toast.success(`Matched ${r?.matched ?? 0} of ${r?.total_unmatched ?? 0} sales`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? 'Attribution failed');
    } finally {
      setRunning(false);
    }
  };

  const exportVendorRoi = () => {
    const rows = perf.map(p => ({
      vendor: p.vendorName,
      leads: p.leads,
      sales: p.sales,
      close_rate_pct: (p.closeRate * 100).toFixed(2),
      cost: p.cost.toFixed(2),
      cpl: p.cpl.toFixed(2),
      cpa: p.cpa.toFixed(2),
      revenue: p.revenue.toFixed(2),
      roi_pct: p.cost > 0 ? (p.roi * 100).toFixed(2) : '',
      category: p.category,
    }));
    downloadCsv(`vendor-roi-${period}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const exportSales = () => {
    const vendorMap = new Map(vendors.map(v => [v.id, v.name]));
    const rows = sales.map(s => ({
      sale_date: s.sale_date ?? '',
      customer: s.customer_full_name ?? '',
      email: s.customer_email ?? '',
      phone: s.customer_phone ?? '',
      vehicle: [s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' '),
      stock_number: s.stock_number ?? '',
      deal_number: s.deal_number ?? '',
      gross: saleRevenue(s).toFixed(2),
      vendor: s.vendor_id ? vendorMap.get(s.vendor_id) ?? '' : '',
      attribution: s.attribution_status,
      confidence: s.attribution_confidence ?? '',
      manual_override: s.manual_override ? 'yes' : 'no',
    }));
    downloadCsv(`sales-${period}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  // A sale is "matched" once it's been linked to either a lead or a vendor
  // (auto, manual, or via override). Status alone misses sales attributed by vendor only.
  const matchedSales = sales.filter(s => !!s.lead_id || !!s.vendor_id).length;
  const matchRate = sales.length > 0 ? matchedSales / sales.length : 0;

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Attribution & ROI</h1>
          <p className="text-sm text-muted-foreground">
            {activeOrg?.name} — vendor performance over the selected window.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={v => setPeriod(v as Period)}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Month</SelectLabel>
                {monthOptions(36).map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportVendorRoi}>
            <Download className="mr-1 h-4 w-4" /> Vendor ROI
          </Button>
          <Button variant="outline" onClick={exportSales}>
            <Download className="mr-1 h-4 w-4" /> Sales
          </Button>
          <Button onClick={runAttribution} disabled={running}>
            <Wand2 className="mr-1 h-4 w-4" />
            {running ? 'Matching...' : 'Run Attribution'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={DollarSign} label="Revenue" value={fmtMoney(totals.revenue)} />
        <StatCard icon={ShoppingCart} label="Sales" value={String(totals.sales)} sub={`${totals.leads} leads`} />
        <StatCard icon={Target} label="Match rate" value={fmtPct(matchRate)} sub={`${matchedSales}/${sales.length} attributed`} />
        <StatCard
          icon={totals.roi >= 0 ? TrendingUp : TrendingDown}
          label="Overall ROI"
          value={totals.cost > 0 ? `${(totals.roi * 100).toFixed(0)}%` : '—'}
          sub={`Cost ${fmtMoney(totals.cost)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue — last 12 months</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: any) => [fmtMoney(Number(v)), 'Revenue']}
                  contentStyle={{ fontSize: 12, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Vendor ROI (selected window)</CardTitle></CardHeader>
          <CardContent className="h-64">
            {roiChart.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vendors with cost data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roiChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <Tooltip
                    formatter={(v: any) => [`${v}%`, 'ROI']}
                    contentStyle={{ fontSize: 12, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Bar dataKey="roi">
                    {roiChart.map((entry, i) => (
                      <Cell key={i} fill={CAT_COLOR[entry.category as VendorPerf['category']]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Vendor performance</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : perf.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No vendors or data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Vendor</th>
                  <th className="px-4 py-2 text-right">Leads</th>
                  <th className="px-4 py-2 text-right">Sales</th>
                  <th className="px-4 py-2 text-right">Close %</th>
                  <th className="px-4 py-2 text-right">Cost</th>
                  <th className="px-4 py-2 text-right">CPL</th>
                  <th className="px-4 py-2 text-right">CPA</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                  <th className="px-4 py-2 text-right">ROI</th>
                  <th className="px-4 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {perf.map(r => (
                  <tr key={r.vendor?.id ?? 'unassigned'} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{r.vendorName}</td>
                    <td className="px-4 py-2 text-right">
                      {r.leads > 0 ? (
                        <button
                          type="button"
                          className="font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => setVendorLeadsView({ id: r.vendor?.id ?? null, name: r.vendorName })}
                        >
                          {r.leads}
                        </button>
                      ) : (
                        r.leads
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.sales > 0 ? (
                        <button
                          type="button"
                          className="font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => setVendorSalesView({ id: r.vendor?.id ?? null, name: r.vendorName })}
                        >
                          {r.sales}
                        </button>
                      ) : (
                        r.sales
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{fmtPct(r.closeRate)}</td>
                    <td className="px-4 py-2 text-right">{r.cost > 0 ? fmtMoney(r.cost) : '—'}</td>
                    <td className="px-4 py-2 text-right">{r.cpl > 0 ? fmtMoney(r.cpl) : '—'}</td>
                    <td className="px-4 py-2 text-right">{r.cpa > 0 ? fmtMoney(r.cpa) : '—'}</td>
                    <td className="px-4 py-2 text-right">{fmtMoney(r.revenue)}</td>
                    <td className="px-4 py-2 text-right">{r.cost > 0 ? `${(r.roi * 100).toFixed(0)}%` : '—'}</td>
                    <td className="px-4 py-2 text-center"><CategoryBadge cat={r.category} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent sales ({sales.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {sales.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No sales imported yet for this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Customer</th>
                  <th className="px-4 py-2 text-left">Vehicle</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Gross</th>
                  <th className="px-4 py-2 text-center">Attribution</th>
                  <th className="px-4 py-2 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 100).map(s => (
                  <tr key={s.id} className="border-b">
                    <td className="px-4 py-2">{s.customer_full_name ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {[s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">{fmtMoney(saleRevenue(s))}</td>
                    <td className="px-4 py-2 text-center">
                      <AttributionBadge status={s.attribution_status} confidence={s.attribution_confidence ?? 0} manual={s.manual_override} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Button variant="ghost" size="sm" onClick={() => { setOverrideSale(s); setOverrideOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <AttributionOverrideDialog
        sale={overrideSale}
        vendors={vendors}
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        onSaved={load}
      />

      <Dialog open={!!vendorSalesView} onOpenChange={(o) => !o && setVendorSalesView(null)}>
        <DialogContent className="max-w-4xl">
          {(() => {
            const knownVendorIds = new Set(vendors.map(v => v.id));

            // Build VIN and stock lookup maps (same as perf useMemo)
            const allVinToVendors = new Map<string, Set<string>>();
            const allStockToVendors = new Map<string, Set<string>>();
            for (const l of leads) {
              if (l.vendor_id) {
                if (l.vin) {
                  const v = l.vin.trim().toUpperCase();
                  if (v) {
                    const s = allVinToVendors.get(v) ?? new Set<string>();
                    s.add(l.vendor_id);
                    allVinToVendors.set(v, s);
                  }
                }
                if (l.stock_number) {
                  const sk = l.stock_number.trim().toUpperCase();
                  if (sk) {
                    const s = allStockToVendors.get(sk) ?? new Set<string>();
                    s.add(l.vendor_id);
                    allStockToVendors.set(sk, s);
                  }
                }
              }
            }

            const list = sales.filter(s => {
              const vin = s.vin ? s.vin.trim().toUpperCase() : '';
              const stock = s.stock_number ? s.stock_number.trim().toUpperCase() : '';

              if (vendorSalesView?.id === null) {
                // Unassigned: no vendor_id, no VIN match, no stock match
                return !s.vendor_id &&
                  !(vin && allVinToVendors.has(vin)) &&
                  !(stock && allStockToVendors.has(stock));
              }

              const vid = vendorSalesView!.id!;
              // Priority 1: direct vendor_id
              if (s.vendor_id === vid) return true;
              // Priority 2: VIN match (only if sale has no vendor_id)
              if (!s.vendor_id && vin && allVinToVendors.get(vin)?.has(vid)) return true;
              // Priority 3: stock_number match (only if sale has no vendor_id and no VIN match)
              if (!s.vendor_id && !vin && stock && allStockToVendors.get(stock)?.has(vid)) return true;
              return false;
            });
            const rev = list.reduce((a, s) => a + saleRevenue(s), 0);
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Sales attributed to {vendorSalesView?.name}</DialogTitle>
                  <DialogDescription>
                    {list.length} sale(s) · {fmtMoney(rev)} total price
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b bg-background text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Customer</th>
                        <th className="px-3 py-2 text-left">VIN</th>
                        <th className="px-3 py-2 text-left">Vehicle</th>
                        <th className="px-3 py-2 text-left">Stock #</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-center">Attribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(s => (
                        <tr key={s.id} className="border-b hover:bg-muted/30">
                          <td className="px-3 py-2 text-muted-foreground">
                            {s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-3 py-2">{s.customer_full_name ?? '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{s.vin ?? '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {[s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ') || '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{s.stock_number ?? '—'}</td>
                          <td className="px-3 py-2 text-right">{fmtMoney(Number(s.sale_price ?? 0))}</td>
                          <td className="px-3 py-2 text-center">
                            <AttributionBadge
                              status={s.attribution_status}
                              confidence={s.attribution_confidence ?? 0}
                              manual={s.manual_override}
                            />
                          </td>
                        </tr>
                      ))}
                      {list.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                            No sales matched this vendor's lead VINs in the selected period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!vendorLeadsView} onOpenChange={(o) => !o && setVendorLeadsView(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Leads attributed to {vendorLeadsView?.name}</DialogTitle>
            <DialogDescription>
              {(() => {
                const list = leads.filter(l =>
                  vendorLeadsView?.id === null ? !l.vendor_id : l.vendor_id === vendorLeadsView?.id
                );
                return `${list.length} lead(s)`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-background text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Phone</th>
                  <th className="px-3 py-2 text-left">Vehicle</th>
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads
                  .filter(l => vendorLeadsView?.id === null ? !l.vendor_id : l.vendor_id === vendorLeadsView?.id)
                  .map(l => (
                    <tr key={l.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">
                        {l.lead_date ? new Date(l.lead_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-2">{l.customer_full_name ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.customer_email ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.customer_phone ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{l.source_label ?? '—'}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{l.lead_status}</Badge></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function CategoryBadge({ cat }: { cat: VendorPerf['category'] }) {
  if (cat === 'CUT') return <Badge variant="destructive"><TrendingDown className="mr-1 h-3 w-3" />Cut</Badge>;
  if (cat === 'OPTIMIZE') return <Badge variant="secondary"><Minus className="mr-1 h-3 w-3" />Optimize</Badge>;
  if (cat === 'SCALE') return <Badge className="bg-green-600 hover:bg-green-700"><TrendingUp className="mr-1 h-3 w-3" />Scale</Badge>;
  return <Badge variant="outline">—</Badge>;
}

function AttributionBadge({ status, confidence, manual }: { status: string; confidence: number; manual: boolean }) {
  if (manual) return <Badge>Manual · 100%</Badge>;
  if (status === 'auto') return <Badge className="bg-blue-600 hover:bg-blue-700">Auto · {confidence}%</Badge>;
  if (status === 'none') return <Badge variant="outline">No match</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}
