import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building2, Users, DollarSign, TrendingUp, ListChecks, Download } from 'lucide-react';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { downloadCsv } from '@/lib/exportCsv';

type Period = 'mtd' | '30d' | '90d' | '12m' | 'all';

function rangeFor(p: Period): { from: Date | null; costMultiplier: number; label: string } {
  const now = new Date();
  if (p === 'mtd') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysElapsed = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000));
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return { from: start, costMultiplier: daysElapsed / daysInMonth, label: 'Month to date' };
  }
  if (p === '30d') return { from: new Date(now.getTime() - 30 * 86400000), costMultiplier: 1, label: 'Last 30 days' };
  if (p === '90d') return { from: new Date(now.getTime() - 90 * 86400000), costMultiplier: 3, label: 'Last 90 days' };
  if (p === '12m') {
    const start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    return { from: start, costMultiplier: 12, label: 'Last 12 months' };
  }
  return { from: null, costMultiplier: 12, label: 'All time' };
}

interface Org { id: string; name: string; status: string }
interface Vendor { id: string; name: string; organization_id: string; monthly_cost: number | null; is_active: boolean }
interface Lead { id: string; organization_id: string; vendor_id: string | null; lead_date: string | null; created_at: string; vin: string | null }
interface Sale { id: string; organization_id: string; vendor_id: string | null; total_gross: number | null; gross_revenue: number | null; sale_price: number | null; sale_date: string | null; vin: string | null }

interface OrgRow {
  id: string;
  name: string;
  status: string;
  leads: number;
  sales: number;
  spend: number;
  revenue: number;
  roi: number;
}

interface VendorRow {
  vendor_name: string;
  org_count: number;
  leads: number;
  sales: number;
  spend: number;
  revenue: number;
  roi: number;
}

export default function AdminOverview() {
  const { setActiveOrgId } = useActiveOrg();
  const [period, setPeriod] = useState<Period>('mtd');
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [userCount, setUserCount] = useState(0);
  const [adminCount, setAdminCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { from } = rangeFor(period);
      const fromIso = from?.toISOString();

      const [orgsRes, vendorsRes, usersRes, adminsRes] = await Promise.all([
        supabase.from('organizations').select('id, name, status').order('name'),
        supabase.from('vendors').select('id, name, organization_id, monthly_cost, is_active'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'admin'),
      ]);

      let leadQ = supabase.from('leads').select('id, organization_id, vendor_id, lead_date, created_at, vin').limit(10000);
      let saleQ = supabase
        .from('sales')
        .select('id, organization_id, vendor_id, total_gross, gross_revenue, sale_price, sale_date, vin')
        .limit(10000);
      if (fromIso) {
        leadQ = leadQ.or(`lead_date.gte.${fromIso},and(lead_date.is.null,created_at.gte.${fromIso})`);
        saleQ = saleQ.gte('sale_date', fromIso);
      }
      const [leadsRes, salesRes] = await Promise.all([leadQ, saleQ]);

      setOrgs((orgsRes.data ?? []) as Org[]);
      setVendors((vendorsRes.data ?? []) as Vendor[]);
      setLeads((leadsRes.data ?? []) as Lead[]);
      setSales((salesRes.data ?? []) as Sale[]);
      setUserCount(usersRes.count ?? 0);
      setAdminCount(adminsRes.count ?? 0);
      setLoading(false);
    };
    load();
  }, [period]);

  const { costMultiplier, label } = rangeFor(period);

  const orgRows: OrgRow[] = useMemo(() => {
    return orgs.map(o => {
      const orgVendors = vendors.filter(v => v.organization_id === o.id && v.is_active);
      const monthlySpend = orgVendors.reduce((s, v) => s + Number(v.monthly_cost ?? 0), 0);
      const spend = monthlySpend * costMultiplier;
      const orgLeads = leads.filter(l => l.organization_id === o.id).length;
      const orgSales = sales.filter(s => s.organization_id === o.id);
      const revenue = orgSales.reduce(
        (s, x) => s + Number(x.total_gross ?? x.gross_revenue ?? 0),
        0,
      );
      const roi = spend > 0 ? (revenue - spend) / spend : 0;
      return {
        id: o.id, name: o.name, status: o.status,
        leads: orgLeads, sales: orgSales.length,
        spend, revenue, roi,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [orgs, vendors, leads, sales, costMultiplier]);

  const vendorRows: VendorRow[] = useMemo(() => {
    // Group vendors by name (e.g. "AutoTrader" across all orgs)
    const byName = new Map<string, { vendor_ids: Set<string>; org_ids: Set<string>; spend: number }>();
    vendors.forEach(v => {
      const key = v.name.trim();
      if (!key) return;
      const entry = byName.get(key) ?? { vendor_ids: new Set(), org_ids: new Set(), spend: 0 };
      entry.vendor_ids.add(v.id);
      entry.org_ids.add(v.organization_id);
      if (v.is_active) entry.spend += Number(v.monthly_cost ?? 0) * costMultiplier;
      byName.set(key, entry);
    });

    const rows: VendorRow[] = [];
    byName.forEach((entry, name) => {
      const leadCount = leads.filter(l => l.vendor_id && entry.vendor_ids.has(l.vendor_id)).length;
      const salesArr = sales.filter(s => s.vendor_id && entry.vendor_ids.has(s.vendor_id));
      const revenue = salesArr.reduce((s, x) => s + Number(x.total_gross ?? x.gross_revenue ?? 0), 0);
      const roi = entry.spend > 0 ? (revenue - entry.spend) / entry.spend : 0;
      rows.push({
        vendor_name: name,
        org_count: entry.org_ids.size,
        leads: leadCount,
        sales: salesArr.length,
        spend: entry.spend,
        revenue,
        roi,
      });
    });
    return rows.sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  }, [vendors, leads, sales, costMultiplier]);

  const totals = useMemo(() => {
    const spend = orgRows.reduce((s, o) => s + o.spend, 0);
    const revenue = orgRows.reduce((s, o) => s + o.revenue, 0);
    return {
      spend,
      revenue,
      roi: spend > 0 ? (revenue - spend) / spend : 0,
      leads: orgRows.reduce((s, o) => s + o.leads, 0),
      sales: orgRows.reduce((s, o) => s + o.sales, 0),
    };
  }, [orgRows]);

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const fmtRoi = (r: number) => `${(r * 100).toFixed(0)}%`;
  const roiBadge = (r: number) =>
    r >= 1 ? 'default' : r >= 0 ? 'secondary' : 'destructive';

  const tiles = [
    { label: 'Dealerships', value: orgs.length, icon: Building2 },
    { label: 'Total Users', value: userCount, sub: `${adminCount} admin`, icon: Users },
    { label: 'Total Leads', value: totals.leads.toLocaleString(), icon: ListChecks },
    { label: 'Total Sales', value: totals.sales.toLocaleString(), icon: TrendingUp },
    { label: 'Total Spend', value: fmt(totals.spend), icon: DollarSign },
    { label: 'Total Revenue', value: fmt(totals.revenue), icon: DollarSign },
  ];

  const exportLeaderboard = () => {
    downloadCsv(`dealership-leaderboard-${period}.csv`, orgRows.map(o => ({
      Dealership: o.name, Status: o.status,
      Leads: o.leads, Sales: o.sales,
      Spend: Math.round(o.spend), Revenue: Math.round(o.revenue),
      ROI: `${(o.roi * 100).toFixed(1)}%`,
    })));
  };

  const drillInto = (orgId: string) => {
    setActiveOrgId(orgId);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Overview</h1>
          <p className="text-sm text-muted-foreground">System-wide performance · {label}</p>
        </div>
        <Select value={period} onValueChange={(v: Period) => setPeriod(v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mtd">Month to date</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="12m">Last 12 months</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map(t => (
          <Card key={t.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground">
                <t.icon className="h-4 w-4" />
                <p className="text-xs">{t.label}</p>
              </div>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {loading ? '—' : t.value}
              </p>
              {t.sub && <p className="text-xs text-muted-foreground">{t.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Aggregate ROI</p>
              <p className="text-3xl font-bold">
                {loading ? '—' : fmtRoi(totals.roi)}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              Net: {fmt(totals.revenue - totals.spend)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Dealership Leaderboard</CardTitle>
          <Button variant="outline" size="sm" onClick={exportLeaderboard} disabled={orgRows.length === 0}>
            <Download className="mr-2 h-4 w-4" />Export
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : orgRows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No dealerships yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dealership</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgRows.map(o => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="font-medium">{o.name}</div>
                      <div className="text-xs text-muted-foreground">{o.status}</div>
                    </TableCell>
                    <TableCell className="text-right">{o.leads.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{o.sales.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{fmt(o.spend)}</TableCell>
                    <TableCell className="text-right">{fmt(o.revenue)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={roiBadge(o.roi)}>{fmtRoi(o.roi)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm" onClick={() => drillInto(o.id)}>
                        <Link to="/attribution">Drill in</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Vendors (Across All Dealerships)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Vendors grouped by name — e.g. AutoTrader rolled up across every org using it.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : vendorRows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No vendor data yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right"># Orgs</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorRows.map(v => (
                  <TableRow key={v.vendor_name}>
                    <TableCell className="font-medium">{v.vendor_name}</TableCell>
                    <TableCell className="text-right">{v.org_count}</TableCell>
                    <TableCell className="text-right">{v.leads.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{v.sales.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{fmt(v.spend)}</TableCell>
                    <TableCell className="text-right">{fmt(v.revenue)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={roiBadge(v.roi)}>{fmtRoi(v.roi)}</Badge>
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
