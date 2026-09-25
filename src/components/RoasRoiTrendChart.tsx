import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { RoasRoiTrendPoint } from '@/lib/dashboardCharts';

// Two lines, one % axis: ROAS (net revenue) and ROI (gross revenue). Shared
// by the Attribution page and the client dashboard so both show the same
// numbers. Null months render as gaps.
export function RoasRoiTrendChart({ data }: { data: RoasRoiTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Number(v).toLocaleString('en-US')}%`} width={64} />
        <Tooltip
          formatter={(v: number | string, name: string) => [`${Number(v).toLocaleString('en-US')}%`, name]}
          contentStyle={{ fontSize: 12, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="roas" name="ROAS" stroke="hsl(var(--muted-foreground))"
          strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
        <Line type="monotone" dataKey="roi" name="ROI" stroke="hsl(var(--primary))"
          strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
