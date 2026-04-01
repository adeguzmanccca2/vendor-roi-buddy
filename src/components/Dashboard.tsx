import { useApp } from '@/context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DollarSign, Users, TrendingUp, Target } from 'lucide-react';

const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
const fmtFull = (n: number) => `$${n.toLocaleString()}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const decisionColor = (d: string) => {
  if (d === 'CUT') return 'destructive' as const;
  if (d === 'SCALE') return 'default' as const;
  return 'secondary' as const;
};

const CHART_COLORS = ['hsl(215, 80%, 48%)', 'hsl(160, 60%, 45%)', 'hsl(38, 92%, 50%)', 'hsl(280, 60%, 50%)', 'hsl(0, 72%, 51%)'];

export default function Dashboard() {
  const { getMetrics } = useApp();
  const metrics = getMetrics();
  const sorted = [...metrics].sort((a, b) => b.roi - a.roi);

  const totalRevenue = metrics.reduce((s, m) => s + m.total_revenue, 0);
  const totalCost = metrics.reduce((s, m) => s + m.cost, 0);
  const totalLeads = metrics.reduce((s, m) => s + m.total_leads, 0);
  const totalSales = metrics.reduce((s, m) => s + m.total_sales, 0);

  const chartData = sorted.map(m => ({ name: m.vendor_name, Revenue: m.total_revenue, Cost: m.cost }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">ROI Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2"><DollarSign className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-xl font-bold text-foreground">{fmtFull(totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-destructive/10 p-2"><Target className="h-5 w-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total Spend</p>
                <p className="text-xl font-bold text-foreground">{fmtFull(totalCost)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent/10 p-2"><Users className="h-5 w-5 text-accent" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total Leads</p>
                <p className="text-xl font-bold text-foreground">{totalLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-success/10 p-2"><TrendingUp className="h-5 w-5 text-success" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-xl font-bold text-foreground">{totalSales}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Revenue by Vendor</CardTitle></CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 88%)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number) => fmtFull(v)} />
                <Bar dataKey="Revenue" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
                <Bar dataKey="Cost" fill="hsl(220, 14%, 80%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Vendor Performance (sorted by ROI)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">CPA</TableHead>
                  <TableHead className="text-right">Close Rate</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                  <TableHead className="text-center">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(m => (
                  <TableRow key={m.vendor_id}>
                    <TableCell className="font-medium">{m.vendor_name}</TableCell>
                    <TableCell className="text-right">{m.total_leads}</TableCell>
                    <TableCell className="text-right">{m.total_sales}</TableCell>
                    <TableCell className="text-right">{fmtFull(m.total_revenue)}</TableCell>
                    <TableCell className="text-right">{fmtFull(m.cost)}</TableCell>
                    <TableCell className="text-right">{fmt(m.cpl)}</TableCell>
                    <TableCell className="text-right">{m.cpa > 0 ? fmt(m.cpa) : '—'}</TableCell>
                    <TableCell className="text-right">{pct(m.close_rate)}</TableCell>
                    <TableCell className="text-right font-semibold">{pct(m.roi)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={decisionColor(m.decision)}>{m.decision}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
