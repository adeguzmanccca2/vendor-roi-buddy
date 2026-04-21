import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wand2, TrendingUp, TrendingDown, Minus, DollarSign, ShoppingCart, Target } from 'lucide-react';
import { toast } from 'sonner';

interface Vendor { id: string; name: string; monthly_cost: number | null }
interface SaleRow {
  id: string; vendor_id: string | null; lead_id: string | null;
  customer_full_name: string | null; sale_date: string | null;
  total_gross: number | null; gross_revenue: number | null;
  attribution_status: string; attribution_confidence: number | null;
  vehicle_year: number | null; vehicle_make: string | null; vehicle_model: string | null;
}
interface LeadCount { vendor_id: string | null }

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

export default function AttributionPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
  const [unattributedLeads, setUnattributedLeads] = useState<number>(0);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [period, setPeriod] = useState<'30' | '90' | 'all'>('90');

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    const sinceIso = period === 'all'
      ? null
      : new Date(Date.now() - parseInt(period, 10) * 86400000).toISOString();

    const vQ = supabase.from('vendors').select('id, name, monthly_cost')
      .eq('organization_id', activeOrgId).order('name');
    const lQ = supabase.from('leads').select('vendor_id')
      .eq('organization_id', activeOrgId);
    let sQ = supabase.from('sales').select('id, vendor_id, lead_id, customer_full_name, sale_date, total_gross, gross_revenue, attribution_status, attribution_confidence, vehicle_year, vehicle_make, vehicle_model')
      .eq('organization_id', activeOrgId);
    if (sinceIso) {
      sQ = sQ.gte('sale_date', sinceIso);
      // leads can't be filtered server-side without a date column always set; client-side ok
    }

    const [{ data: vData }, { data: lData }, { data: sData }] = await Promise.all([vQ, lQ, sQ]);
    const vs = (vData ?? []) as Vendor[];
    const ls = (lData ?? []) as LeadCount[];
    setVendors(vs);
    const counts: Record<string, number> = {};
    let unassigned = 0;
    for (const l of ls) {
      if (!l.vendor_id) { unassigned++; continue; }
      counts[l.vendor_id] = (counts[l.vendor_id] ?? 0) + 1;
    }
    setLeadCounts(counts);
    setUnattributedLeads(unassigned);
    setSales((sData ?? []) as SaleRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeOrgId, period]);

  const periodMonths = period === 'all' ? 12 : Math.max(1, Math.round(parseInt(period, 10) / 30));

  const perf: VendorPerf[] = useMemo(() => {
    const byVendor = new Map<string | null, { revenue: number; sales: number }>();
    for (const s of sales) {
      const key = s.vendor_id;
      const cur = byVendor.get(key) ?? { revenue: 0, sales: 0 };
      cur.revenue += Number(s.total_gross ?? s.gross_revenue ?? 0);
      cur.sales += 1;
      byVendor.set(key, cur);
    }

    const rows: VendorPerf[] = vendors.map(v => {
      const agg = byVendor.get(v.id) ?? { revenue: 0, sales: 0 };
      const leads = leadCounts[v.id] ?? 0;
      const cost = Number(v.monthly_cost ?? 0) * periodMonths;
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
  }, [vendors, sales, leadCounts, unattributedLeads, periodMonths]);

  const totals = useMemo(() => {
    const t = perf.reduce((acc, r) => ({
      revenue: acc.revenue + r.revenue,
      cost: acc.cost + r.cost,
      sales: acc.sales + r.sales,
      leads: acc.leads + r.leads,
    }), { revenue: 0, cost: 0, sales: 0, leads: 0 });
    return { ...t, roi: t.cost > 0 ? (t.revenue - t.cost) / t.cost : 0 };
  }, [perf]);

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

  const matchedSales = sales.filter(s => s.attribution_status === 'auto' || s.attribution_status === 'manual').length;
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
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={v => setPeriod(v as any)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor performance</CardTitle>
        </CardHeader>
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
                    <td className="px-4 py-2 text-right">{r.leads}</td>
                    <td className="px-4 py-2 text-right">{r.sales}</td>
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
        <CardHeader>
          <CardTitle className="text-base">Recent sales ({sales.length})</CardTitle>
        </CardHeader>
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
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 50).map(s => (
                  <tr key={s.id} className="border-b">
                    <td className="px-4 py-2">{s.customer_full_name ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {[s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">{fmtMoney(Number(s.total_gross ?? s.gross_revenue ?? 0))}</td>
                    <td className="px-4 py-2 text-center">
                      <AttributionBadge status={s.attribution_status} confidence={s.attribution_confidence ?? 0} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
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

function AttributionBadge({ status, confidence }: { status: string; confidence: number }) {
  if (status === 'auto') return <Badge className="bg-blue-600 hover:bg-blue-700">Auto · {confidence}%</Badge>;
  if (status === 'manual') return <Badge>Manual</Badge>;
  if (status === 'none') return <Badge variant="outline">No match</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}
