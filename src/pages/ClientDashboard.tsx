import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Info, DollarSign, ShoppingCart, ListChecks, TrendingUp, Download } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { downloadCsv } from '@/lib/exportCsv';
import { buildVendorComparisonData, type VendorComparisonSeries } from '@/lib/dashboardCharts';
import { resolveLeadTotal, type ManualLeadCountBreakdown } from '@/lib/manualLeadCounts';

interface Org { id: string; name: string; slug: string; status: string }
interface SaleLite { sale_date: string | null; sale_price: number | null; vendor_id: string | null; lead_id: string | null }
interface LeadLite { lead_date: string | null; vendor_id: string | null }
interface VendorLite { id: string; name: string; monthly_cost: number | null }
interface VendorCost { id: string; monthly_cost: number | null; firstLeadDate: string | null }

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// WHY: Build a list of years from 2020 to current year for the year picker.
const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i);

export default function ClientDashboard() {
  const { profile } = useAuth();
  const { activeOrgId, activeOrg: activeOrgMeta } = useActiveOrg();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ leads: 0, sales: 0, revenue: 0 });
  const [vendorCosts, setVendorCosts] = useState<VendorCost[]>([]);
  const [trendSales, setTrendSales] = useState<SaleLite[]>([]);
  const [trendLeads, setTrendLeads] = useState<LeadLite[]>([]);
  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [exportRows, setExportRows] = useState<Record<string, any>[]>([]);
  const [manualLeadCounts, setManualLeadCounts] = useState<Record<string, ManualLeadCountBreakdown>>({});

  // WHY: selectedYear drives all YTD queries. Defaults to current year.
  // When the user picks a different year, the useEffect re-fires and
  // re-fetches all stats for that year's Jan 1 → Dec 31 window.
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  useEffect(() => {
    if (!activeOrgId) {
      setManualLeadCounts({});
      setLoading(false);
      return;
    }

    const savedManualCounts = window.localStorage.getItem(`attribution-manual-leads-${activeOrgId}`);
    if (savedManualCounts) {
      try {
        setManualLeadCounts(JSON.parse(savedManualCounts) as Record<string, ManualLeadCountBreakdown>);
      } catch {
        window.localStorage.removeItem(`attribution-manual-leads-${activeOrgId}`);
        setManualLeadCounts({});
      }
    } else {
      setManualLeadCounts({});
    }
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId) {
      setLoading(false);
      return;
    }
    // WHY: Reset all stats immediately when org or year changes so stale
    // numbers from the previous selection never show while the new fetch
    // is in flight.
    setStats({ leads: 0, sales: 0, revenue: 0 });
    setVendorCosts([]);
    setTrendSales([]);
    setExportRows([]);
    setOrg(null);
    setLoading(true);

    const orgId = activeOrgId;

    // WHY: YTD = Jan 1 00:00:00 of selectedYear → Dec 31 23:59:59 of selectedYear.
    // Using explicit year boundaries means the year filter works for any past year,
    // not just the current one.
    const ytdStart = new Date(Date.UTC(selectedYear, 0, 1)).toISOString();        // Jan 1 UTC
    const ytdEnd   = new Date(Date.UTC(selectedYear, 11, 31, 23, 59, 59, 999)).toISOString(); // Dec 31 UTC

    // Trend: always show last 12 months from today regardless of selected year
    const now = new Date();
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();

    Promise.all([
      supabase.from('organizations').select('id, name, slug, status').eq('id', orgId).maybeSingle(),
      // Leads YTD count
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('lead_date', ytdStart)
        .lte('lead_date', ytdEnd),
      // Sales YTD
      supabase.from('sales').select('sale_price')
        .eq('organization_id', orgId)
        .gte('sale_date', ytdStart)
        .lte('sale_date', ytdEnd),
      // Vendor costs — fetch id + monthly_cost so we can look up first lead date per vendor
      supabase.from('vendors').select('id, name, monthly_cost').eq('organization_id', orgId).eq('is_active', true),
      // First lead date per vendor — used to calculate months active
      supabase.from('leads').select('vendor_id, lead_date')
        .eq('organization_id', orgId)
        .not('vendor_id', 'is', null)
        .order('lead_date', { ascending: true }),
      // Revenue trend (last 12 months, always current)
      supabase.from('sales').select('sale_date, sale_price, vendor_id, lead_id')
        .eq('organization_id', orgId)
        .gte('sale_date', trendStart),
      // Lead counts for comparison (last 12 months)
      supabase.from('leads').select('lead_date, vendor_id')
        .eq('organization_id', orgId)
        .gte('lead_date', trendStart),
      // Leads export (YTD for selected year)
      supabase.from('leads').select('customer_full_name, customer_email, customer_phone, vehicle_of_interest, lead_date, lead_status, vendor_id')
        .eq('organization_id', orgId)
        .gte('lead_date', ytdStart)
        .lte('lead_date', ytdEnd)
        .limit(5000),
    ]).then(([orgRes, leadsRes, salesRes, vendorsRes, allLeadsRes, trendSalesRes, trendLeadsRes, leadsExportRes]) => {
      setOrg(orgRes.data ?? null);
      const revenue = (salesRes.data ?? []).reduce(
        (a, s) => a + Number(s.sale_price ?? 0), 0,
      );

      // Build a map of vendor_id → earliest lead_date
      const firstLeadByVendor: Record<string, string> = {};
      for (const l of allLeadsRes.data ?? []) {
        if (l.vendor_id && l.lead_date && !firstLeadByVendor[l.vendor_id]) {
          firstLeadByVendor[l.vendor_id] = l.lead_date;
        }
      }

      const costs: VendorCost[] = (vendorsRes.data ?? []).map((v: any) => ({
        id: v.id,
        monthly_cost: v.monthly_cost,
        firstLeadDate: firstLeadByVendor[v.id] ?? null,
      }));

      const vendorIds = (vendorsRes.data ?? []).map((v: any) => v.id);
      const fallbackCountsByVendor: Record<string, number> = {};
      for (const lead of (leadsExportRes.data ?? []) as Array<{ vendor_id: string | null }>) {
        if (!lead.vendor_id) continue;
        fallbackCountsByVendor[lead.vendor_id] = (fallbackCountsByVendor[lead.vendor_id] ?? 0) + 1;
      }
      const leadCount = resolveLeadTotal({
        manualLeadCounts,
        vendorIds,
        fallbackCountsByVendor,
        fallbackUnassignedCount: (leadsExportRes.data ?? []).filter((lead: any) => !lead.vendor_id).length,
      });

      setVendorCosts(costs);
      setStats({ leads: leadCount, sales: salesRes.data?.length ?? 0, revenue });
      setTrendSales((trendSalesRes.data ?? []) as SaleLite[]);
      setTrendLeads((trendLeadsRes.data ?? []) as LeadLite[]);
      setVendors((vendorsRes.data ?? []) as VendorLite[]);
      setExportRows((leadsExportRes.data ?? []) as any[]);
      setLoading(false);
    });
  }, [activeOrgId, manualLeadCounts, selectedYear]);

  // WHY: Cost is calculated per vendor based on when they first sent a lead.
  // months_active = months from first lead date to end of selected period.
  // This avoids over-counting cost for vendors that started mid-year.
  const ytdCost = useMemo(() => {
    if (vendorCosts.length === 0) return 0;

    // End of the selected period — Dec 31 for past years, today for current year
    const periodEnd = selectedYear < currentYear
      ? new Date(selectedYear, 11, 31, 23, 59, 59)
      : new Date();

    // Start of the selected year
    const yearStart = new Date(selectedYear, 0, 1);

    return vendorCosts.reduce((total, v) => {
      const monthlyCost = Number(v.monthly_cost ?? 0);
      if (monthlyCost === 0) return total;

      // No leads yet — can't determine start date, exclude from cost
      if (!v.firstLeadDate) return total;

      const firstLead = new Date(v.firstLeadDate);

      // Vendor's first lead is after the selected period — not active this period
      if (firstLead > periodEnd) return total;

      // Vendor start for this period = later of (first lead date, Jan 1 of selected year)
      const vendorStart = firstLead < yearStart ? yearStart : firstLead;

      // Months active = difference in months between vendorStart and periodEnd
      // Using ceil so a partial month counts as a full month
      const monthsActive = Math.ceil(
        (periodEnd.getTime() - vendorStart.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      );

      return total + monthlyCost * Math.max(monthsActive, 1);
    }, 0);
  }, [vendorCosts, selectedYear]);

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
      if (key in buckets) buckets[key] += Number(s.sale_price ?? 0);
    }
    return Object.entries(buckets).map(([month, revenue]) => ({
      month: month.slice(5) + '/' + month.slice(2, 4),
      revenue,
    }));
  }, [trendSales]);

  const comparison = useMemo(() => buildVendorComparisonData({
    leads: trendLeads,
    sales: trendSales,
    vendors,
    months: 12,
  }), [trendLeads, trendSales, vendors]);

  const exportLeads = () =>
    downloadCsv(`leads-ytd-${selectedYear}-${new Date().toISOString().slice(0, 10)}.csv`, exportRows);

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  if (!activeOrgId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Welcome</h1>
        <Card>
          <CardContent className="flex items-start gap-3 pt-6">
            <Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">No dealership assigned yet</p>
              <p className="text-sm text-muted-foreground">
                Your account hasn't been linked to a dealership. Please contact your administrator.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const roi = ytdCost > 0 ? (stats.revenue - ytdCost) / ytdCost : 0;
  const isCurrentYear = selectedYear === currentYear;
  const periodLabel = isCurrentYear ? 'Year-to-date' : `Full year ${selectedYear}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{activeOrgMeta?.name ?? org?.name ?? 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground">{periodLabel} · trend over last 12 months</p>
        </div>
        <div className="flex items-center gap-2">
          {/* WHY: Year picker placed before action buttons so it's clearly a
              filter that affects the stats, not a button that triggers an action. */}
          <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportLeads} disabled={exportRows.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export Leads
          </Button>
          <Button asChild>
            <Link to="/attribution"><TrendingUp className="mr-1 h-4 w-4" />Attribution</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={ListChecks} label={`Leads (YTD)`} value={String(stats.leads)} />
        <Stat icon={ShoppingCart} label={`Sales (YTD)`} value={String(stats.sales)} />
        <Stat icon={DollarSign} label={`Revenue (YTD)`} value={fmtMoney(stats.revenue)} />
        <Stat
          icon={TrendingUp}
          label={`ROI (YTD)`}
          value={ytdCost > 0 && stats.sales > 0 ? `${(roi * 100).toFixed(0)}%` : '—'}
          sub={`Cost ${fmtMoney(ytdCost)}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue trend — last 12 months</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
        <CardHeader>
          <CardTitle className="text-base">Vendor attribution — last 12 months</CardTitle>
          <p className="text-xs text-muted-foreground">
            Total attributed sales and total leads, plus a leads breakdown by vendor.
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparison.data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value: any, name: any) => [value, name === 'attributedSales' ? 'Attributed sales' : name]}
                  contentStyle={{ fontSize: 12, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                />
                {comparison.series.map(series => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <VendorAttributionLegend series={comparison.series} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Dealership
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Name:</span> {org?.name}</p>
          <p><span className="text-muted-foreground">Slug:</span> {org?.slug}</p>
          <p><span className="text-muted-foreground">Status:</span> {org?.status}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function LegendSwatch({ series }: { series: VendorComparisonSeries }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
      {series.label}
    </span>
  );
}

// Totals (attributed sales, total leads) render first; the per-vendor leads
// breakdown is grouped under its own heading below them, per request.
function VendorAttributionLegend({ series }: { series: VendorComparisonSeries[] }) {
  const totals = series.filter(s => s.key === 'attributedSales' || s.key === 'totalLeads');
  const vendors = series.filter(s => s.key.startsWith('vendor:'));

  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-4">
        {totals.map(s => <LegendSwatch key={s.key} series={s} />)}
      </div>
      {vendors.length > 0 && (
        <div>
          <p className="mb-1.5 font-medium text-muted-foreground">Leads Breakdown by Vendor</p>
          <div className="flex flex-wrap items-center gap-4">
            {vendors.map(s => <LegendSwatch key={s.key} series={s} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
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
