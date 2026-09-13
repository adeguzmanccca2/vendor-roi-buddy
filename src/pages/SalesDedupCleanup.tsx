import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, PlayCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { buildDedupHash, normalizeName } from '@/lib/normalize';

// One-time cleanup for sales imported before database-level dedup existed
// (dedup_hash was only ever set on NEW rows going forward). Two jobs in one
// pass: find TRUE duplicates among existing sales and remove the extras, and
// give every surviving row the same fingerprint new imports get, so future
// re-uploads of an already-imported file are finally caught for these rows
// too. See SalesUpload.tsx's dedup_hash computation — this mirrors it exactly
// so a sale re-uploaded after cleanup hashes identically and is rejected.
interface SaleRow {
  id: string;
  customer_full_name: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vin: string | null;
  stock_number: string | null;
  sale_date: string | null;
  sale_price: number | null;
  manual_override: boolean;
  created_at: string;
}

interface HashedSale extends SaleRow {
  hash: string;
  hasCredit: boolean;
}

interface DuplicateGroup {
  hash: string;
  keeper: HashedSale;
  losers: HashedSale[];
}

const fmtMoney = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function SalesDedupCleanupPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [uniqueRows, setUniqueRows] = useState<HashedSale[]>([]);

  const analyze = async () => {
    if (!activeOrgId) return;
    setAnalyzing(true);
    setGroups(null);
    try {
      const { data: rows, error } = await supabase
        .from('sales')
        .select('id, customer_full_name, normalized_email, normalized_phone, vehicle_year, vehicle_make, vehicle_model, vin, stock_number, sale_date, sale_price, manual_override, created_at')
        .eq('organization_id', activeOrgId)
        .is('dedup_hash', null);
      if (error) throw error;

      const { data: creditRows, error: credErr } = await supabase
        .from('sale_attributions')
        .select('sale_id')
        .eq('organization_id', activeOrgId);
      if (credErr) throw credErr;
      const creditedSaleIds = new Set((creditRows ?? []).map((r: { sale_id: string }) => r.sale_id));

      const sales = (rows ?? []) as SaleRow[];
      const hashed: HashedSale[] = await Promise.all(sales.map(async (s) => {
        const hash = await buildDedupHash({
          email: s.normalized_email,
          phone: s.normalized_phone,
          name: normalizeName(s.customer_full_name),
          vehicle: [s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' '),
          vin: s.vin,
          stock_number: s.stock_number,
          lead_date: s.sale_date,
        });
        return { ...s, hash, hasCredit: creditedSaleIds.has(s.id) };
      }));

      const byHash = new Map<string, HashedSale[]>();
      for (const h of hashed) {
        const list = byHash.get(h.hash) ?? [];
        list.push(h);
        byHash.set(h.hash, list);
      }

      const dupGroups: DuplicateGroup[] = [];
      const singles: HashedSale[] = [];
      for (const list of byHash.values()) {
        if (list.length === 1) { singles.push(list[0]); continue; }
        // Keeper priority: a manual override is a deliberate human decision
        // and is never the one deleted. Otherwise prefer whichever copy
        // already has a vendor credit (true duplicates share identical VIN/
        // stock/email/phone, so they earn identical credits — nothing is
        // lost by discarding the other copy's redundant rows). Last resort:
        // whichever was imported first.
        const sorted = [...list].sort((a, b) => {
          if (a.manual_override !== b.manual_override) return a.manual_override ? -1 : 1;
          if (a.hasCredit !== b.hasCredit) return a.hasCredit ? -1 : 1;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        dupGroups.push({ hash: list[0].hash, keeper: sorted[0], losers: sorted.slice(1) });
      }

      setGroups(dupGroups);
      setUniqueRows(singles);

      const totalLosers = dupGroups.reduce((a, g) => a + g.losers.length, 0);
      toast.success(`Found ${dupGroups.length} duplicate group(s) — ${totalLosers} row(s) to remove, ${singles.length} row(s) just need a fingerprint`);
    } catch (e: any) {
      toast.error('Analysis failed: ' + (e.message ?? 'Unknown error'));
    } finally {
      setAnalyzing(false);
    }
  };

  const apply = async () => {
    if (!activeOrgId || groups === null) return;
    setApplying(true);
    try {
      const loserIds = groups.flatMap(g => g.losers.map(l => l.id));
      const CHUNK = 50;
      for (let i = 0; i < loserIds.length; i += CHUNK) {
        const slice = loserIds.slice(i, i + CHUNK);
        if (slice.length === 0) continue;
        const { error } = await supabase.from('sales').delete().in('id', slice);
        if (error) throw error;
      }

      // Per-row update: each survivor gets its OWN hash, so this can't be a
      // single batched call keyed on one value.
      const toHash = [...groups.map(g => g.keeper), ...uniqueRows];
      for (const row of toHash) {
        const { error } = await supabase.from('sales').update({ dedup_hash: row.hash }).eq('id', row.id);
        if (error) throw error;
      }

      toast.success(`Removed ${loserIds.length} duplicate sale(s), fingerprinted ${toHash.length} row(s)`);
      setGroups(null);
      setUniqueRows([]);
    } catch (e: any) {
      toast.error('Cleanup failed: ' + (e.message ?? 'Unknown error') + ' — some rows may be partially updated; re-run Analyze to see current state.');
    } finally {
      setApplying(false);
    }
  };

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  const totalLosers = groups?.reduce((a, g) => a + g.losers.length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2">
          <Link to="/sales"><ArrowLeft className="mr-1 h-4 w-4" /> Back to Sales</Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Sales Duplicate Cleanup</h1>
        <p className="text-sm text-muted-foreground">
          {activeOrg?.name} — one-time pass over sales imported before database-level dedup existed.
          Removes true duplicates and gives every remaining row a fingerprint, so future re-uploads
          of already-imported sales are caught automatically going forward.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Step 1: Analyze</CardTitle>
          <Button variant="outline" onClick={analyze} disabled={analyzing || applying}>
            <PlayCircle className="mr-1 h-4 w-4" /> {analyzing ? 'Analyzing...' : 'Run analysis'}
          </Button>
        </CardHeader>
        <CardContent>
          {groups === null ? (
            <p className="text-sm text-muted-foreground">Click "Run analysis" to scan for sales missing a dedup fingerprint. This only reads — nothing is changed yet.</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No duplicates found. Apply below to fingerprint the {uniqueRows.length} remaining row(s) — no deletions.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2 text-sm">
                <Badge variant="destructive">{groups.length} duplicate group(s)</Badge>
                <Badge variant="destructive">{totalLosers} row(s) will be deleted</Badge>
                <Badge variant="secondary">{uniqueRows.length} row(s) just get a fingerprint</Badge>
              </div>
              <div className="space-y-4">
                {groups.map((g, i) => (
                  <div key={g.hash} className="rounded-md border border-border overflow-hidden">
                    <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">Group {i + 1}</div>
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Action</th>
                          <th className="px-3 py-1.5 text-left">Customer</th>
                          <th className="px-3 py-1.5 text-left">Date</th>
                          <th className="px-3 py-1.5 text-right">Price</th>
                          <th className="px-3 py-1.5 text-left">VIN</th>
                          <th className="px-3 py-1.5 text-left">Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b bg-green-50 dark:bg-green-950/20">
                          <td className="px-3 py-1.5"><Badge className="bg-green-600 hover:bg-green-700">Keep</Badge></td>
                          <td className="px-3 py-1.5">{g.keeper.customer_full_name ?? '—'}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{g.keeper.sale_date ? new Date(g.keeper.sale_date).toLocaleDateString() : '—'}</td>
                          <td className="px-3 py-1.5 text-right">{fmtMoney(g.keeper.sale_price)}</td>
                          <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{g.keeper.vin ?? '—'}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">
                            {g.keeper.manual_override ? 'Manually overridden' : g.keeper.hasCredit ? 'Has vendor credit' : 'Imported first'}
                          </td>
                        </tr>
                        {g.losers.map(l => (
                          <tr key={l.id} className="border-b">
                            <td className="px-3 py-1.5"><Badge variant="destructive">Delete</Badge></td>
                            <td className="px-3 py-1.5">{l.customer_full_name ?? '—'}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{l.sale_date ? new Date(l.sale_date).toLocaleDateString() : '—'}</td>
                            <td className="px-3 py-1.5 text-right">{fmtMoney(l.sale_price)}</td>
                            <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{l.vin ?? '—'}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">Duplicate</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {groups !== null && (
        <Card>
          <CardHeader><CardTitle className="text-base">Step 2: Apply</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {totalLosers > 0
                ? `This permanently deletes ${totalLosers} duplicate sale(s) and fingerprints the ${groups.length + uniqueRows.length} remaining row(s). This cannot be undone from within the app.`
                : `No deletions — this fingerprints ${uniqueRows.length} row(s).`}
            </p>
            <Button variant={totalLosers > 0 ? 'destructive' : 'default'} onClick={apply} disabled={applying}>
              <Trash2 className="mr-1 h-4 w-4" /> {applying ? 'Applying...' : 'Apply cleanup'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
