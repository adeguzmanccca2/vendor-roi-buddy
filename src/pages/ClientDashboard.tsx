import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, Info, DollarSign, ShoppingCart, ListChecks, TrendingUp } from 'lucide-react';

interface Org { id: string; name: string; slug: string; status: string }

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function ClientDashboard() {
  const { profile } = useAuth();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ leads: 0, sales: 0, revenue: 0, cost: 0 });

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false);
      return;
    }
    const orgId = profile.organization_id;
    const since = new Date(Date.now() - 90 * 86400000).toISOString();

    Promise.all([
      supabase.from('organizations').select('id, name, slug, status').eq('id', orgId).maybeSingle(),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('lead_date', since),
      supabase.from('sales').select('total_gross, gross_revenue').eq('organization_id', orgId).gte('sale_date', since),
      supabase.from('vendors').select('monthly_cost').eq('organization_id', orgId).eq('is_active', true),
    ]).then(([orgRes, leadsRes, salesRes, vendorsRes]) => {
      setOrg(orgRes.data ?? null);
      const revenue = (salesRes.data ?? []).reduce(
        (a, s) => a + Number(s.total_gross ?? s.gross_revenue ?? 0), 0,
      );
      const cost = (vendorsRes.data ?? []).reduce((a, v) => a + Number(v.monthly_cost ?? 0), 0) * 3;
      setStats({
        leads: leadsRes.count ?? 0,
        sales: salesRes.data?.length ?? 0,
        revenue,
        cost,
      });
      setLoading(false);
    });
  }, [profile?.organization_id]);

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

  const roi = stats.cost > 0 ? (stats.revenue - stats.cost) / stats.cost : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{org?.name ?? 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground">Last 90 days</p>
        </div>
        <Button asChild><Link to="/attribution"><TrendingUp className="mr-1 h-4 w-4" />View Attribution</Link></Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={ListChecks} label="Leads" value={String(stats.leads)} />
        <Stat icon={ShoppingCart} label="Sales" value={String(stats.sales)} />
        <Stat icon={DollarSign} label="Revenue" value={fmtMoney(stats.revenue)} />
        <Stat icon={TrendingUp} label="ROI" value={stats.cost > 0 ? `${(roi * 100).toFixed(0)}%` : '—'} sub={`Cost ${fmtMoney(stats.cost)}`} />
      </div>

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
