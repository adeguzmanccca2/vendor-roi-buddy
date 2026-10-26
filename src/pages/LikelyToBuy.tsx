import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/StatCard';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Download, Flame, Thermometer, Eye, Users, Search, ChevronDown, HelpCircle } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';
import {
  POINTS, RECENT_LEAD_DAYS, WARM_MIN, WATCH_MIN,
  scoreLikelyToBuy, type LtbLead, type LtbResult, type LtbSale, type Tier,
} from '@/lib/likelyToBuy';
import { toast } from 'sonner';

const PAGE_SIZE = 1000;
const SHOW_STEP = 200;
const ALL = '__all__';
const LOOKBACK_KEY = 'vroi.ltbLookback';
const HOW_OPEN_KEY = 'vroi.ltbHowOpen';

const LOOKBACKS = [
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 1 year' },
  { value: '24', label: 'Last 2 years' },
  { value: 'all', label: 'All history' },
];

const SALE_FIELDS = 'id, customer_full_name, customer_phone, customer_email, normalized_phone, normalized_email, work_phone, home_phone, sale_date, new_used, vehicle_year, vehicle_make, vehicle_model, vehicle_of_interest, salesperson, birthday';
const LEAD_FIELDS = 'id, vendor_id, lead_date, created_at, normalized_phone, normalized_email, customer_phone, customer_email, vehicle_year, vehicle_make, vehicle_model, vehicle_of_interest';

const TIER_LABEL: Record<Tier, string> = { hot: 'Hot', warm: 'Warm', watch: 'Watch' };
const TIER_CLASS: Record<Tier, string> = {
  hot: 'border-transparent bg-red-600 text-white hover:bg-red-600',
  warm: 'border-transparent bg-orange-500 text-white hover:bg-orange-500',
  watch: 'border-transparent bg-amber-200 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/60 dark:text-amber-100',
};

/** What each tier means, in the dealer's terms. Shown on the badge and in the scoring guide. */
const TIER_MEANING: Record<Tier, string> = {
  hot: `Bought from you before AND sent a new lead in the last ${RECENT_LEAD_DAYS} days. They are shopping right now — call first.`,
  warm: `No new lead yet, but ${WARM_MIN}+ points: usually due for a trade-in, often with other signals on top. Worth a call this month.`,
  watch: `${WATCH_MIN}–${WARM_MIN - 1} points: getting close to trade-in time or one smaller signal. Keep in touch; not urgent yet.`,
};

/** The scoring guide's signal table, kept next to the POINTS it describes. */
const SIGNALS: { points: number; signal: string; detail: string }[] = [
  { points: POINTS.recentLead, signal: 'New lead from a past buyer', detail: `They submitted a lead through any vendor in the last ${RECENT_LEAD_DAYS} days. Always makes them Hot.` },
  { points: POINTS.multipleLeads, signal: 'Several leads in 30 days', detail: '2 or more leads in the last 30 days — actively shopping.' },
  { points: POINTS.multipleVendors, signal: 'Shopping on several lead sources', detail: 'Leads came through 2 or more vendors — likely comparing dealers.' },
  { points: POINTS.timingDue, signal: 'Due for a trade-in', detail: 'Used buyers 18+ months after purchase; new buyers 36+ months.' },
  { points: POINTS.timingApproaching, signal: 'Nearing trade-in time', detail: 'Used buyers 12–18 months after purchase; new buyers 24–36 months.' },
  { points: POINTS.repeatBuyer, signal: 'Repeat buyer', detail: 'Bought from you 2 or more times (latest purchase at least 6 months ago).' },
  { points: POINTS.olderLead, signal: 'Sent a lead a while back', detail: `Submitted a lead after buying, but more than ${RECENT_LEAD_DAYS} days ago.` },
  { points: POINTS.birthday, signal: 'Birthday this month', detail: 'Only when the sale record has a birthday and they bought 12+ months ago.' },
];

function readHowOpen(): boolean {
  try { return localStorage.getItem(HOW_OPEN_KEY) !== 'closed'; } catch { return true; }
}

function readLookback(): string {
  try { return localStorage.getItem(LOOKBACK_KEY) ?? '24'; } catch { return '24'; }
}

function lookbackStart(lookback: string): string | null {
  if (lookback === 'all') return null;
  const d = new Date();
  d.setMonth(d.getMonth() - Number(lookback));
  return d.toISOString();
}

/** Page through a query 1,000 rows at a time (PostgREST caps each response). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '');

export default function LikelyToBuyPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [lookback, setLookback] = useState(readLookback);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<LtbResult>({ prospects: [], vendors: [] });
  const [salesCount, setSalesCount] = useState(0);
  const [vendorNames, setVendorNames] = useState<Map<string, string>>(new Map());
  const [tierFilter, setTierFilter] = useState<string>(ALL);
  const [conditionFilter, setConditionFilter] = useState<string>(ALL);
  const [salespersonFilter, setSalespersonFilter] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [showCount, setShowCount] = useState(SHOW_STEP);
  const [howOpen, setHowOpen] = useState(readHowOpen);

  useEffect(() => {
    try { localStorage.setItem(HOW_OPEN_KEY, howOpen ? 'open' : 'closed'); } catch { /* per-viewer convenience only */ }
  }, [howOpen]);

  useEffect(() => {
    try { localStorage.setItem(LOOKBACK_KEY, lookback); } catch { /* per-viewer convenience only */ }
  }, [lookback]);

  useEffect(() => {
    if (!activeOrgId) return;
    // A slow load for an old look-back or org must not overwrite a newer one.
    let cancelled = false;
    const start = lookbackStart(lookback);

    (async () => {
      setLoading(true);
      try {
        const [sales, leads, vendors] = await Promise.all([
          fetchAll<LtbSale>((from, to) => {
            let q = supabase.from('sales').select(SALE_FIELDS).eq('organization_id', activeOrgId);
            if (start) q = q.gte('sale_date', start);
            return q.order('id').range(from, to);
          }),
          fetchAll<LtbLead>((from, to) => {
            let q = supabase.from('leads').select(LEAD_FIELDS).eq('organization_id', activeOrgId);
            if (start) q = q.or(`lead_date.gte.${start},and(lead_date.is.null,created_at.gte.${start})`);
            return q.order('id').range(from, to);
          }),
          supabase.from('vendors').select('id, name').eq('organization_id', activeOrgId),
        ]);
        if (cancelled) return;
        if (vendors.error) throw new Error(vendors.error.message);
        setVendorNames(new Map((vendors.data ?? []).map(v => [v.id, v.name])));
        setSalesCount(sales.length);
        setResult(scoreLikelyToBuy(sales, leads));
        setShowCount(SHOW_STEP);
      } catch (err) {
        if (!cancelled) toast.error('Failed to load Likely to Buy: ' + (err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeOrgId, lookback]);

  const { prospects, vendors } = result;

  const salespeople = useMemo(
    () => [...new Set(prospects.map(p => p.salesperson).filter((s): s is string => !!s))].sort(),
    [prospects],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return prospects.filter(p => {
      if (tierFilter !== ALL && p.tier !== tierFilter) return false;
      if (conditionFilter !== ALL && p.condition !== conditionFilter) return false;
      if (salespersonFilter !== ALL && p.salesperson !== salespersonFilter) return false;
      if (s) {
        const hay = [p.name, p.phone, p.email, p.lastVehicle, p.interestedIn].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [prospects, tierFilter, conditionFilter, salespersonFilter, search]);

  const counts = useMemo(() => {
    const c = { hot: 0, warm: 0, watch: 0 };
    for (const p of prospects) c[p.tier]++;
    return c;
  }, [prospects]);

  const vendorLabel = (id: string) => vendorNames.get(id) ?? 'Unknown vendor';
  const lookbackLabel = LOOKBACKS.find(l => l.value === lookback)?.label.toLowerCase() ?? '';

  function exportCsv() {
    downloadCsv(
      `likely-to-buy-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map(p => ({
        Tier: TIER_LABEL[p.tier],
        Score: p.score,
        Customer: p.name,
        Phone: p.phone ?? '',
        Email: p.email ?? '',
        'Last purchase': fmtDate(p.lastSaleDate),
        Vehicle: p.lastVehicle,
        'New/Used': p.condition ?? '',
        Purchases: p.purchases,
        Salesperson: p.salesperson ?? '',
        'Latest lead': fmtDate(p.recentLeadDate),
        'Lead sources': p.recentLeadVendorIds.map(vendorLabel).join('; '),
        'Interested in': p.interestedIn ?? '',
        Why: p.reasons.map(r => `+${r.points} ${r.text}`).join(' · '),
      })),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Likely to Buy</h1>
          <p className="text-sm text-muted-foreground">
            {activeOrg?.name} · Past customers who look ready to buy again, from their purchases and new leads
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={lookback} onValueChange={setLookback}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOOKBACKS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="mr-1 h-4 w-4" />Export call list
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard accent="rose" icon={Flame} label="Hot" value={String(counts.hot)}
          info={<p>{TIER_MEANING.hot}</p>} />
        <StatCard accent="ember" icon={Thermometer} label="Warm" value={String(counts.warm)}
          info={<p>{TIER_MEANING.warm}</p>} />
        <StatCard accent="amber" icon={Eye} label="Watch" value={String(counts.watch)}
          info={<p>{TIER_MEANING.watch}</p>} />
        <StatCard icon={Users} label="Sales analyzed" value={salesCount.toLocaleString()}
          info={<p>Sales in the {lookbackLabel}. Customers are matched by phone and email, never by name alone. Longer history finds more trade-in candidates.</p>} />
      </div>

      <Collapsible open={howOpen} onOpenChange={setHowOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between gap-2 p-4 text-left">
              <span className="flex items-center gap-2 text-base font-semibold text-foreground">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />How scoring works
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${howOpen ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0 text-sm">
              <p className="text-muted-foreground">
                We look at every past customer in your sales file and check two things: <strong className="text-foreground">how long
                since they bought</strong>, and <strong className="text-foreground">whether they've sent you a new lead</strong> through
                any vendor since then. Each signal adds points; the points decide the tier. Customers are matched to leads by phone or
                email only — never by name alone — so a different person with the same name won't show up as Hot.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {(['hot', 'warm', 'watch'] as Tier[]).map(t => (
                  <div key={t} className="rounded-md border border-border p-3">
                    <Badge className={TIER_CLASS[t]}>{TIER_LABEL[t]}</Badge>
                    <p className="mt-2 text-muted-foreground">{TIER_MEANING[t]}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20 text-right">Points</TableHead>
                      <TableHead>Signal</TableHead>
                      <TableHead>When it counts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SIGNALS.map(sig => (
                      <TableRow key={sig.signal}>
                        <TableCell className="text-right font-medium">+{sig.points}</TableCell>
                        <TableCell className="font-medium">{sig.signal}</TableCell>
                        <TableCell className="text-muted-foreground">{sig.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                New vs. used comes from the sale's New/Used column when it has one; otherwise a vehicle two or more model years old
                at the time of sale counts as used. Leads within 30 days after a purchase are ignored — those are the leads that
                produced the sale, not a new shopping trip.
              </p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Customers to call</CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, vehicle…" className="h-9 pl-8" />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All tiers</SelectItem>
                <SelectItem value="hot">Hot</SelectItem>
                <SelectItem value="warm">Warm</SelectItem>
                <SelectItem value="watch">Watch</SelectItem>
              </SelectContent>
            </Select>
            <Select value={conditionFilter} onValueChange={setConditionFilter}>
              <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>New & used</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="used">Used</SelectItem>
              </SelectContent>
            </Select>
            <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All salespeople</SelectItem>
                {salespeople.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Analyzing sales and leads…</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {prospects.length === 0
                ? 'No likely buyers found yet. Try a longer look-back, or upload more sales history.'
                : 'No customers match these filters.'}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tier</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Last purchase</TableHead>
                      <TableHead>Why</TableHead>
                      <TableHead>Salesperson</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, showCount).map(p => (
                      <TableRow key={p.key}>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge tabIndex={0} className={`cursor-help ${TIER_CLASS[p.tier]}`}>{TIER_LABEL[p.tier]}</Badge>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs text-xs">{TIER_MEANING[p.tier]}</TooltipContent>
                          </Tooltip>
                          <div className="mt-1 text-xs text-muted-foreground">{p.score} pts</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{[p.phone, p.email].filter(Boolean).join(' · ')}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-foreground">{p.lastVehicle || '—'}</div>
                          <div className="text-xs text-muted-foreground">
                            {[fmtDate(p.lastSaleDate), p.condition && p.condition[0].toUpperCase() + p.condition.slice(1)].filter(Boolean).join(' · ')}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <ul className="space-y-0.5 text-sm text-foreground">
                            {p.reasons.map(r => (
                              <li key={r.text} className="flex gap-2">
                                <span className="w-8 shrink-0 text-right font-medium text-muted-foreground">+{r.points}</span>
                                <span>{r.text}</span>
                              </li>
                            ))}
                          </ul>
                          {(p.recentLeadVendorIds.length > 0 || p.interestedIn) && (
                            <div className="text-xs text-muted-foreground">
                              {[
                                p.recentLeadVendorIds.length > 0 && `via ${p.recentLeadVendorIds.map(vendorLabel).join(', ')}`,
                                p.interestedIn && `looking at ${p.interestedIn}`,
                              ].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{p.salesperson ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Showing {Math.min(showCount, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span>
                {showCount < filtered.length && (
                  <Button variant="outline" size="sm" onClick={() => setShowCount(c => c + SHOW_STEP)}>Show more</Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Returning customers by vendor</CardTitle>
          <p className="text-sm text-muted-foreground">
            Leads in the {lookbackLabel} from people who had already bought from you. A high share means the vendor is
            charging you for customers who may have come back anyway.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? null : vendors.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No vendor leads in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Already customers</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendors.map(v => (
                    <TableRow key={v.vendorId}>
                      <TableCell className="font-medium">{vendorLabel(v.vendorId)}</TableCell>
                      <TableCell className="text-right">{v.leads.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{v.returning.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{v.leads ? Math.round((v.returning / v.leads) * 100) : 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
