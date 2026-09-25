import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { RevenueTrendPoint } from '@/lib/dashboardCharts';
import { formatCompactMoney } from '@/lib/utils';

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const NET = 'hsl(var(--chart-1))';
const ADDED = 'hsl(var(--chart-2))';

function RevenueTooltip({ active, payload }: { active?: boolean; payload?: { payload: RevenueTrendPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-foreground">{p.month} · {p.vehicles} vehicle{p.vehicles === 1 ? '' : 's'}</p>
      <p className="flex items-center gap-2 text-foreground">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: NET }} />
        Net <span className="ml-auto pl-4 tabular-nums">{fmtMoney(p.net)}</span>
      </p>
      <p className="flex items-center gap-2 text-foreground">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: ADDED }} />
        Avg gross × vehicles <span className="ml-auto pl-4 tabular-nums">{fmtMoney(p.avgGrossAdded)}</span>
      </p>
      <p className="mt-1 flex border-t pt-1 font-semibold text-foreground">
        Gross revenue <span className="ml-auto pl-4 tabular-nums">{fmtMoney(p.gross)}</span>
      </p>
    </div>
  );
}

// Monthly revenue as stacked bars: net (sale prices) + avg gross x vehicles,
// so each bar's full height is that month's gross revenue.
export function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCompactMoney(Number(v))} width={56} />
        <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="net" name="Net" stackId="rev" fill={NET} stroke="hsl(var(--background))" strokeWidth={2} maxBarSize={36} />
        <Bar dataKey="avgGrossAdded" name="Avg gross × vehicles" stackId="rev" fill={ADDED}
          stroke="hsl(var(--background))" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}
