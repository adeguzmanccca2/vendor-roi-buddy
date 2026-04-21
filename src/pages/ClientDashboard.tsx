import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, Info, DollarSign, ShoppingCart, ListChecks, TrendingUp, Download } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { downloadCsv } from '@/lib/exportCsv';

interface Org { id: string; name: string; slug: string; status: string }
interface SaleLite { sale_date: string | null; total_gross: number | null; gross_revenue: number | null }

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function ClientDashboard() {
  const { profile } = useAuth();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ leads: 0, sales: 0, revenue: 0, monthlyCost: 0 });
  const [trendSales, setTrendSales] = useState<SaleLite[]>([]);
  const [exportRows, setExportRows] = useState<Record<string, any>[]>([]);

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false);
      return;
    }
    const orgId = profile.organization_id;
    const now = new Date();
    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();

    Promise.all([
      supabase.from('organizations').select('id, name, slug, status').eq('id', orgId).maybeSingle(),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('lead_date', mtdStart),
      supabase.from('sales').select('total_gross, gross_revenue').eq('organization_id', orgId).gte('sale_date', mtdStart),
      supabase.from('vendors').select('monthly_cost').eq('organization_id', orgId).eq('is_active', true),
      supabase.from('sales').select('sale_date, total_gross, gross_revenue').eq('organization_id', orgId).gte('sale_date', trendStart),
      supabase.from('leads').select('customer_full_name, customer_email, customer_phone, vehicle_of_interest, lead_date, lead_status, vendor_id').eq('organization_id', orgId).gte('lead_date', mtdStart).limit(5000),
    ]).then(([orgRes, leadsRes, salesRes, vendorsRes, trendRes, leadsExportRes]) => {
      setOrg(orgRes.data ?? null);
      const revenue = (salesRes.data ?? []).reduce(
        (a, s) => a + Number(s.total_gross ?? s.gross_revenue ?? 0), 0,
      );
      const monthlyCost = (vendorsRes.data ?? []).reduce((a, v) => a + Number(v.monthly_cost ?? 0), 0);
      setStats({
        leads: leadsRes.count ?? 0,
        sales: salesRes.data?.length ?? 0,
        revenue,
        monthlyCost,
      });
      setTrendSales((trendRes.data ?? []) as SaleLite[]);
      setExportRows((leadsExportRes.data ?? []) as any[]);
      setLoading(false);
    });
  }, [profile?.organization_id]);

  // Pro-rate cost to month-to-date elapsed days for fair MTD ROI.
  const mtdCost = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return stats.monthlyCost * (now.getDate() / daysInMonth);
  }, [stats.monthlyCost]);

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
      if (key in buckets) buckets[key] += Number(s.total_gross ?? s.gross_revenue ?? 0);
    }
    return Object.entries(buckets).map(([month, revenue]) => ({
      month: month.slice(5) + '/' + month.slice(2, 4),
      revenue,
    }));
  }, [trendSales]);

  const exportLeads = () =>
    downloadCsv(`leads-mtd-${new Date().toISOString().slice(0, 10)}.csv`, exportRows);

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  if (!profile?.organization_id) {
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

  const roi = mtdCost > 0 ? (stats.revenue - mtdCost) / mtdCost : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{org?.name ?? 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground">Month-to-date · trend over last 12 months</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportLeads} disabled={exportRows.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export Leads
          </Button>
          <Button asChild><Link to="/attribution"><TrendingUp className="mr-1 h-4 w-4" />Attribution</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={ListChecks} label="Leads (MTD)" value={String(stats.leads)} />
        <Stat icon={ShoppingCart} label="Sales (MTD)" value={String(stats.sales)} />
        <Stat icon={DollarSign} label="Revenue (MTD)" value={fmtMoney(stats.revenue)} />
        <Stat
          icon={TrendingUp}
          label="ROI (MTD)"
          value={mtdCost > 0 ? `${(roi * 100).toFixed(0)}%` : '—'}
          sub={`Cost ${fmtMoney(mtdCost)}`}
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
