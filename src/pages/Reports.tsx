import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListChecks, ClipboardList, GitCompare, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface Vendor { id: string; name: string }
interface LeadReportRow {
  id: string;
  organization_id: string;
  vendor_id: string | null;
  year: number;
  month: number;
  crm_count: number;
  created_at?: string;
  updated_at?: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2020 + 1 }, (_, i) => CURRENT_YEAR - i);
const VARIANCE_THRESHOLD = 0.05;
const DEBOUNCE_MS = 800;

export default function ReportsPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [vendorId, setVendorId] = useState<string>('all');
  const [systemCounts, setSystemCounts] = useState<Record<number, number>>({});
  const [crmRows, setCrmRows] = useState<Record<number, LeadReportRow>>({});
  const [crmDrafts, setCrmDrafts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const saveTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!activeOrgId) return;
    supabase.from('vendors').select('id, name').eq('organization_id', activeOrgId).order('name')
      .then(({ data }) => setVendors((data ?? []) as Vendor[]));
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId) return;
    saveTimers.current.forEach(t => clearTimeout(t));
    saveTimers.current.clear();
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const sysPromises = Array.from({ length: 12 }, (_, i) => {
          const start = new Date(Date.UTC(year, i, 1)).toISOString();
          const end = new Date(Date.UTC(year, i + 1, 1)).toISOString();
          let q = supabase.from('leads').select('id', { count: 'exact', head: true })
            .eq('organization_id', activeOrgId)
            .gte('lead_date', start)
            .lt('lead_date', end);
          if (vendorId !== 'all') q = q.eq('vendor_id', vendorId);
          return q;
        });

        let crmQ = (supabase as any).from('lead_reports').select('*')
          .eq('organization_id', activeOrgId)
          .eq('year', year);
        crmQ = vendorId === 'all' ? crmQ.is('vendor_id', null) : crmQ.eq('vendor_id', vendorId);

        const [sysResults, crmResult] = await Promise.all([Promise.all(sysPromises), crmQ]);
        if (cancelled) return;

        const counts: Record<number, number> = {};
        sysResults.forEach((r, i) => { counts[i + 1] = r.count ?? 0; });

        if (crmResult.error) {
          toast.error('Failed to load CRM data: ' + crmResult.error.message);
        }
        const rows = (crmResult.data ?? []) as LeadReportRow[];
        const rowMap: Record<number, LeadReportRow> = {};
        const drafts: Record<number, number> = {};
        for (const r of rows) {
          rowMap[r.month] = r;
          drafts[r.month] = r.crm_count;
        }

        setSystemCounts(counts);
        setCrmRows(rowMap);
        setCrmDrafts(drafts);
      } catch (e: any) {
        if (!cancelled) toast.error('Failed to load report: ' + (e.message ?? 'Unknown error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeOrgId, year, vendorId]);

  useEffect(() => () => {
    saveTimers.current.forEach(t => clearTimeout(t));
    saveTimers.current.clear();
  }, []);

  const saveCrm = async (month: number, value: number) => {
    if (!activeOrgId) return;
    const existing = crmRows[month];
    if (existing) {
      const { data, error } = await (supabase as any).from('lead_reports')
        .update({ crm_count: value, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) { toast.error('Save failed: ' + error.message); return; }
      if (data) setCrmRows(prev => ({ ...prev, [month]: data as LeadReportRow }));
    } else {
      const payload = {
        organization_id: activeOrgId,
        vendor_id: vendorId === 'all' ? null : vendorId,
        year,
        month,
        crm_count: value,
      };
      const { data, error } = await (supabase as any).from('lead_reports')
        .insert(payload).select().single();
      if (error) { toast.error('Save failed: ' + error.message); return; }
      if (data) setCrmRows(prev => ({ ...prev, [month]: data as LeadReportRow }));
    }
  };

  const handleCrmChange = (month: number, raw: string) => {
    const num = raw === '' ? 0 : Math.max(0, parseInt(raw, 10) || 0);
    setCrmDrafts(prev => ({ ...prev, [month]: num }));
    const existingTimer = saveTimers.current.get(month);
    if (existingTimer) clearTimeout(existingTimer);
    const t = setTimeout(() => {
      saveTimers.current.delete(month);
      saveCrm(month, num);
    }, DEBOUNCE_MS);
    saveTimers.current.set(month, t);
  };

  const rows = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const systemCount = systemCounts[month] ?? 0;
    const crmCount = crmDrafts[month] ?? 0;
    const diff = systemCount - crmCount;
    const variance = crmCount > 0 ? diff / crmCount : null;
    return { month, systemCount, crmCount, diff, variance };
  }), [systemCounts, crmDrafts]);

  const totals = useMemo(() => {
    const sysTotal = rows.reduce((a, r) => a + r.systemCount, 0);
    const crmTotal = rows.reduce((a, r) => a + r.crmCount, 0);
    const diffTotal = sysTotal - crmTotal;
    const matched = rows.filter(r => r.variance !== null && Math.abs(r.variance) <= VARIANCE_THRESHOLD).length;
    const totalVariance = crmTotal > 0 ? diffTotal / crmTotal : null;
    return { sysTotal, crmTotal, diffTotal, matched, totalVariance };
  }, [rows]);

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  const fmtDiff = (n: number) => (n > 0 ? `+${n}` : String(n));
  const fmtPct = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground">
            {activeOrg?.name} — leads comparison: system vs CRM.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={ListChecks} label="System leads" value={String(totals.sysTotal)} />
        <StatCard icon={ClipboardList} label="CRM reported" value={String(totals.crmTotal)} />
        <StatCard icon={GitCompare} label="Total difference" value={fmtDiff(totals.diffTotal)} sub={fmtPct(totals.totalVariance)} />
        <StatCard icon={CheckCircle2} label="Months matched" value={`${totals.matched}/12`} sub="Variance within ±5%" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Monthly breakdown</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Month</th>
                  <th className="px-4 py-2 text-right">System count</th>
                  <th className="px-4 py-2 text-right">CRM count</th>
                  <th className="px-4 py-2 text-right">Difference</th>
                  <th className="px-4 py-2 text-right">Variance %</th>
                  <th className="px-4 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.month} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{MONTH_NAMES[r.month - 1]} {year}</td>
                    <td className="px-4 py-2 text-right">{r.systemCount}</td>
                    <td className="px-4 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        value={crmDrafts[r.month] ?? ''}
                        onChange={e => handleCrmChange(r.month, e.target.value)}
                        className="ml-auto h-8 w-24 text-right"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">{fmtDiff(r.diff)}</td>
                    <td className="px-4 py-2 text-right">{fmtPct(r.variance)}</td>
                    <td className="px-4 py-2 text-center"><StatusBadge variance={r.variance} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                <tr>
                  <td className="px-4 py-2 text-left">Total</td>
                  <td className="px-4 py-2 text-right">{totals.sysTotal}</td>
                  <td className="px-4 py-2 text-right">{totals.crmTotal}</td>
                  <td className="px-4 py-2 text-right">{fmtDiff(totals.diffTotal)}</td>
                  <td className="px-4 py-2 text-right">{fmtPct(totals.totalVariance)}</td>
                  <td className="px-4 py-2 text-center">—</td>
                </tr>
              </tfoot>
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

function StatusBadge({ variance }: { variance: number | null }) {
  if (variance === null) return <Badge variant="outline">—</Badge>;
  if (Math.abs(variance) <= VARIANCE_THRESHOLD) return <Badge className="bg-green-600 hover:bg-green-700">Match</Badge>;
  return <Badge variant="destructive">Gap</Badge>;
}
