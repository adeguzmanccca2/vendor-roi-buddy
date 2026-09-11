import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, PlayCircle, Check } from 'lucide-react';
import { toast } from 'sonner';

// Temporary diagnostic page for the new multi-vendor sale attribution model.
// Calls the READ-ONLY preview_sale_attributions_for_org() SQL function (see
// supabase/migrations/20260911000001_sale_attributions_dry_run.sql) — it
// writes nothing. This page exists only so the dry-run output can be
// reviewed in the running app instead of the Supabase SQL editor, before
// the write-capable matcher and permanent UI are built.
interface DryRunRow {
  sale_id: string;
  vendor_id: string;
  vendor_name: string;
  lead_id: string;
  matched_on: 'vin' | 'stock' | 'email' | 'phone';
  confidence: number;
  sale_customer: string | null;
  sale_date: string | null;
  sale_price: number | null;
  sale_vin: string | null;
  sale_stock: string | null;
  lead_customer: string | null;
  lead_date: string | null;
}

const fmtMoney = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const MATCH_LABEL: Record<DryRunRow['matched_on'], string> = {
  vin: 'VIN', stock: 'Stock#', email: 'Email', phone: 'Phone',
};

export default function AttributionDryRunPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [rows, setRows] = useState<DryRunRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);

  const run = async () => {
    if (!activeOrgId) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc('preview_sale_attributions_for_org', { _org_id: activeOrgId });
      if (error) throw error;
      setRows((data ?? []) as DryRunRow[]);
      toast.success(`Dry run found ${data?.length ?? 0} new attribution row(s)`);
    } catch (e: any) {
      toast.error('Dry run failed: ' + (e.message ?? 'Unknown error'));
    } finally {
      setRunning(false);
    }
  };

  // Commits what the preview above proposed. Insert-only and idempotent —
  // see attribute_sale_credits_for_org(); running it twice adds nothing the
  // second time and can never overwrite an existing attribution.
  const apply = async () => {
    if (!activeOrgId || !rows || rows.length === 0) return;
    setApplying(true);
    try {
      const { data, error } = await supabase.rpc('attribute_sale_credits_for_org', { _org_id: activeOrgId });
      if (error) throw error;
      toast.success(`Inserted ${data ?? 0} new attribution row(s)`);
      // Re-preview: everything just written is now excluded, so a correct
      // run leaves an empty result — a built-in confirmation it committed.
      await run();
    } catch (e: any) {
      toast.error('Apply failed: ' + (e.message ?? 'Unknown error'));
    } finally {
      setApplying(false);
    }
  };

  const summary = useMemo(() => {
    if (!rows) return null;
    const bySale = new Map<string, number>();
    for (const r of rows) bySale.set(r.sale_id, (bySale.get(r.sale_id) ?? 0) + 1);
    const multiVendorSales = Array.from(bySale.values()).filter(n => n > 1).length;
    return { totalRows: rows.length, distinctSales: bySale.size, multiVendorSales };
  }, [rows]);

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2">
          <Link to="/attribution"><ArrowLeft className="mr-1 h-4 w-4" /> Back to Attribution</Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Attribution Dry Run</h1>
        <p className="text-sm text-muted-foreground">
          {activeOrg?.name} — preview only, writes nothing. Shows exactly what the new
          multi-vendor matcher would insert into <code className="px-1 rounded bg-muted">sale_attributions</code> right now.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Run preview</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={run} disabled={running || applying}>
              <PlayCircle className="mr-1 h-4 w-4" /> {running ? 'Running...' : 'Run dry run'}
            </Button>
            <Button
              onClick={apply}
              disabled={applying || running || !rows || rows.length === 0}
              title={!rows || rows.length === 0 ? 'Run the dry run first — there is nothing to apply' : undefined}
            >
              <Check className="mr-1 h-4 w-4" />
              {applying ? 'Applying...' : `Apply ${rows?.length ?? 0} row(s)`}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {summary && (
            <div className="mb-4 flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{summary.totalRows} new row(s)</Badge>
              <Badge variant="secondary">{summary.distinctSales} distinct sale(s)</Badge>
              <Badge variant={summary.multiVendorSales > 0 ? 'default' : 'outline'}>
                {summary.multiVendorSales} sale(s) with 2+ vendors
              </Badge>
            </div>
          )}

          {rows === null ? (
            <p className="text-sm text-muted-foreground">Click "Run dry run" to preview.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No new attribution rows — nothing new to credit for this org right now.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Sale #</th>
                    <th className="px-3 py-2 text-left">Sale Customer</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-left">VIN</th>
                    <th className="px-3 py-2 text-left">Stock #</th>
                    <th className="px-3 py-2 text-left">Vendor</th>
                    <th className="px-3 py-2 text-left">Matched On</th>
                    <th className="px-3 py-2 text-right">Conf.</th>
                    <th className="px-3 py-2 text-left">Matched Lead</th>
                    <th className="px-3 py-2 text-left">Lead Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const sameSaleAsPrev = i > 0 && rows[i - 1].sale_id === r.sale_id;
                    return (
                      <tr key={`${r.sale_id}-${r.vendor_id}`} className={`border-t ${sameSaleAsPrev ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                        {/* Short sale ref: distinguishes rows that would otherwise look
                            identical when a customer has more than one sale the same day. */}
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.sale_id.slice(0, 8)}</td>
                        <td className="px-3 py-2">{r.sale_customer ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.sale_date ? new Date(r.sale_date).toLocaleDateString() : '—'}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(r.sale_price)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.sale_vin ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.sale_stock ?? '—'}</td>
                        <td className="px-3 py-2 font-medium">{r.vendor_name}</td>
                        <td className="px-3 py-2"><Badge variant="outline">{MATCH_LABEL[r.matched_on]}</Badge></td>
                        <td className="px-3 py-2 text-right">{r.confidence}%</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.lead_customer ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.lead_date ? new Date(r.lead_date).toLocaleDateString() : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Rows highlighted amber share a sale with the row above them — that's a sale getting credited to more than one vendor.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
