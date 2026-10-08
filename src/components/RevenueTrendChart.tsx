import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { RevenueTrendPoint } from '@/lib/dashboardCharts';
import { formatCompactMoney } from '@/lib/utils';

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const NET = 'hsl(var(--chart-1))';
const PROFIT = 'hsl(var(--chart-2))';

function RevenueTooltip({ active, payload }: { active?: boolean; payload?: { payload: RevenueTrendPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-foreground">{p.month} · {p.vehicles} vehicle{p.vehicles === 1 ? '' : 's'}</p>
      <p className="flex items-center gap-2 text-foreground">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: NET }} />
        Total Sales <span className="ml-auto pl-4 tabular-nums">{fmtMoney(p.net)}</span>
      </p>
      <p className="flex items-center gap-2 text-foreground">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: PROFIT }} />
        Profit <span className="ml-auto pl-4 tabular-nums">{fmtMoney(p.profit)}</span>
      </p>
    </div>
  );
}

// Monthly Total Sales (sale prices) and Profit (avg gross x vehicles) as
// side-by-side bars.
export function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCompactMoney(Number(v))} width={56} />
        <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="net" name="Total Sales" fill={NET} radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar dataKey="profit" name="Profit" fill={PROFIT} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
