import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { VendorComparisonPoint, VendorComparisonSeries } from '@/lib/dashboardCharts';

function LeadsTooltip({ active, payload, label, series }: {
  active?: boolean;
  label?: string;
  payload?: { payload: VendorComparisonPoint }[];
  series: VendorComparisonSeries[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const total = series.reduce((a, s) => a + Number(point[s.key] ?? 0), 0);
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-foreground">{label}</p>
      {series.map(s => (
        <p key={s.key} className="flex items-center gap-2 text-foreground">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
          {s.label}
          <span className="ml-auto pl-4 tabular-nums">{Number(point[s.key] ?? 0)}</span>
        </p>
      ))}
      <p className="mt-1 flex border-t pt-1 font-semibold text-foreground">
        Total <span className="ml-auto pl-4 tabular-nums">{total}</span>
      </p>
    </div>
  );
}

// Leads per vendor per month as stacked bars: one segment per vendor, so a
// bar's height is that month's total vendor leads. Reuses the vendor series
// (and colours) of the Vendor attribution chart so a vendor looks the same
// in both.
export function VendorLeadsChart({ data, series }: {
  data: VendorComparisonPoint[];
  series: VendorComparisonSeries[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
        <Tooltip content={<LeadsTooltip series={series} />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="leads" fill={s.color}
            stroke="hsl(var(--background))" strokeWidth={2} maxBarSize={36}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
