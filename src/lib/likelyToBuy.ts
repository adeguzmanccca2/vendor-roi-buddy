/**
 * "Likely to Buy" scoring: finds past customers who look ready to buy again,
 * from their purchase history (sales) plus any leads they've submitted since.
 *
 * The rules are fixed on purpose -- every dealership gets the same logic, and
 * every point a customer earns comes with a plain-English reason, so the
 * dealer can see why someone is on the list.
 *
 * Customers are identified by phone and email only (never by name alone):
 * a name-only match would turn every "John Smith" lead into a false Hot alert.
 */
import { normalizeEmail, normalizePhone } from './normalize';

export interface LtbSale {
  id: string;
  customer_full_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  normalized_phone: string | null;
  normalized_email: string | null;
  work_phone: string | null;
  home_phone: string | null;
  sale_date: string | null;
  new_used: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_of_interest: string | null;
  salesperson: string | null;
  birthday: string | null;
}

export interface LtbLead {
  id: string;
  vendor_id: string | null;
  lead_date: string | null;
  created_at: string;
  normalized_phone: string | null;
  normalized_email: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_of_interest: string | null;
}

export type Tier = 'hot' | 'warm' | 'watch';
export type Condition = 'new' | 'used' | null;

export interface Prospect {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  tier: Tier;
  score: number;
  reasons: string[];
  lastSaleDate: string;
  lastVehicle: string;
  condition: Condition;
  salesperson: string | null;
  monthsSince: number;
  purchases: number;
  recentLeadDate: string | null;
  recentLeadVendorIds: string[];
  interestedIn: string | null;
}

export interface VendorReturning {
  vendorId: string;
  leads: number;
  returning: number;
}

export interface LtbResult {
  prospects: Prospect[];
  vendors: VendorReturning[];
}

const DAY = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30.4375;
/** A lead this soon after a purchase is post-sale noise, not a new shopping trip. */
const POST_SALE_GRACE_DAYS = 30;
/** A lead this recent means the customer is shopping right now. */
const RECENT_LEAD_DAYS = 90;

// Points per signal. Tiers: any recent lead = Hot; otherwise >= 30 Warm, >= 10 Watch.
export const POINTS = {
  recentLead: 60,
  multipleLeads: 15,
  multipleVendors: 15,
  olderLead: 10,
  timingDue: 30,
  timingApproaching: 15,
  repeatBuyer: 20,
  birthday: 10,
} as const;
const WARM_MIN = 30;
const WATCH_MIN = 10;

function toTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function leadTime(l: LtbLead): number | null {
  return toTime(l.lead_date) ?? toTime(l.created_at);
}

function vehicleLabel(v: { vehicle_year: number | null; vehicle_make: string | null; vehicle_model: string | null; vehicle_of_interest: string | null }): string {
  const parts = [v.vehicle_year, v.vehicle_make, v.vehicle_model].filter(Boolean).join(' ');
  return parts || (v.vehicle_of_interest ?? '').trim();
}

/**
 * New or used. Uses the sale's new_used column when present; the CSV upload
 * doesn't capture it, so otherwise infer from model year vs. sale year
 * (anything two or more model years old at sale is treated as used).
 */
export function saleCondition(sale: Pick<LtbSale, 'new_used' | 'vehicle_year' | 'sale_date'>): Condition {
  const nu = (sale.new_used ?? '').trim().toLowerCase();
  if (nu) {
    if (nu.startsWith('n')) return 'new';
    if (nu.startsWith('u') || nu.includes('cpo') || nu.includes('certified') || nu.includes('pre')) return 'used';
  }
  const t = toTime(sale.sale_date);
  if (!sale.vehicle_year || t === null) return null;
  return new Date(t).getUTCFullYear() - sale.vehicle_year >= 2 ? 'used' : 'new';
}

/** Birth month (0-11) from YYYY-MM-DD or MM/DD/YYYY; null if unparseable. */
export function birthMonth(s: string | null | undefined): number | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})/.exec(s.trim());
  const us = /^(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}/.exec(s.trim());
  const m = iso ? Number(iso[2]) : us ? Number(us[1]) : NaN;
  return m >= 1 && m <= 12 ? m - 1 : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function formatMonths(months: number): string {
  if (months < 24) return plural(Math.floor(months), 'month');
  return `${(Math.floor(months / 12 * 10) / 10).toString()} years`;
}

function shortDate(t: number): string {
  return new Date(t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
}

/** Phone/email keys a sale can be matched on. */
function saleKeys(s: LtbSale): string[] {
  const keys = new Set<string>();
  for (const p of [s.normalized_phone, normalizePhone(s.customer_phone), normalizePhone(s.work_phone), normalizePhone(s.home_phone)]) {
    if (p) keys.add(`p:${p}`);
  }
  const e = s.normalized_email ?? normalizeEmail(s.customer_email);
  if (e) keys.add(`e:${e}`);
  return [...keys];
}

function leadKeys(l: LtbLead): string[] {
  const keys: string[] = [];
  const p = l.normalized_phone ?? normalizePhone(l.customer_phone);
  const e = l.normalized_email ?? normalizeEmail(l.customer_email);
  if (p) keys.push(`p:${p}`);
  if (e) keys.push(`e:${e}`);
  return keys;
}

/**
 * Score customers and count returning-customer leads per vendor.
 *
 * `sales` and `leads` should already be limited to the look-back window; the
 * caller decides how far back to search.
 */
export function scoreLikelyToBuy(sales: LtbSale[], leads: LtbLead[], now: Date = new Date()): LtbResult {
  const nowT = now.getTime();

  // Group sales into customers: two sales sharing any phone or email are the
  // same person (union-find, so A~B via phone and B~C via email joins all three).
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };

  const datedSales = sales.filter(s => toTime(s.sale_date) !== null);
  const keysBySale = new Map<string, string[]>();
  for (const s of datedSales) {
    const keys = saleKeys(s);
    keysBySale.set(s.id, keys);
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }

  // Sales with no phone or email can't be matched to leads or other sales;
  // each stands alone as its own customer.
  const salesByCustomer = new Map<string, LtbSale[]>();
  for (const s of datedSales) {
    const keys = keysBySale.get(s.id)!;
    const root = keys.length ? find(keys[0]) : `sale:${s.id}`;
    const list = salesByCustomer.get(root) ?? [];
    list.push(s);
    salesByCustomer.set(root, list);
  }

  const leadsByCustomer = new Map<string, LtbLead[]>();
  const vendorStats = new Map<string, VendorReturning>();
  for (const l of leads) {
    const t = leadTime(l);
    const root = leadKeys(l).find(k => parent.has(k));
    const customer = root ? find(root) : null;
    if (customer) {
      const list = leadsByCustomer.get(customer) ?? [];
      list.push(l);
      leadsByCustomer.set(customer, list);
    }
    if (l.vendor_id && t !== null) {
      const v = vendorStats.get(l.vendor_id) ?? { vendorId: l.vendor_id, leads: 0, returning: 0 };
      v.leads++;
      // "Already your customer" = bought from you before this lead came in.
      const boughtBefore = customer !== null && (salesByCustomer.get(customer) ?? [])
        .some(s => toTime(s.sale_date)! < t - POST_SALE_GRACE_DAYS * DAY);
      if (boughtBefore) v.returning++;
      vendorStats.set(l.vendor_id, v);
    }
  }

  const prospects: Prospect[] = [];
  for (const [key, custSales] of salesByCustomer) {
    custSales.sort((a, b) => toTime(b.sale_date)! - toTime(a.sale_date)!);
    const last = custSales[0];
    const lastT = toTime(last.sale_date)!;
    const monthsSince = Math.max(0, (nowT - lastT) / DAY / MONTH_DAYS);
    const condition = saleCondition(last);
    const lastVehicle = vehicleLabel(last);
    const vehicleText = lastVehicle ? `${condition ? condition + ' ' : ''}${lastVehicle}` : condition ? `a ${condition} vehicle` : 'a vehicle';

    let score = 0;
    const reasons: string[] = [];

    // Shopping since their last purchase (leads before it are the leads that
    // produced that sale, so they don't count).
    const shopping = (leadsByCustomer.get(key) ?? [])
      .map(l => ({ l, t: leadTime(l)! }))
      .filter(x => x.t !== null && x.t > lastT + POST_SALE_GRACE_DAYS * DAY && x.t <= nowT + DAY)
      .sort((a, b) => b.t - a.t);
    const recent = shopping.filter(x => x.t >= nowT - RECENT_LEAD_DAYS * DAY);
    const recentVendorIds = [...new Set(recent.map(x => x.l.vendor_id).filter((v): v is string => !!v))];
    let interestedIn: string | null = null;

    if (recent.length) {
      score += POINTS.recentLead;
      reasons.push(`New lead on ${shortDate(recent[0].t)}`);
      interestedIn = recent.map(x => vehicleLabel(x.l)).find(Boolean) ?? null;
      const last30 = recent.filter(x => x.t >= nowT - 30 * DAY).length;
      if (last30 >= 2) {
        score += POINTS.multipleLeads;
        reasons.push(`${last30} leads in the last 30 days`);
      }
      if (recentVendorIds.length >= 2) {
        score += POINTS.multipleVendors;
        reasons.push(`Shopping on ${recentVendorIds.length} lead sources`);
      }
    } else if (shopping.length) {
      score += POINTS.olderLead;
      reasons.push(`Sent a lead ${formatMonths((nowT - shopping[0].t) / DAY / MONTH_DAYS)} ago`);
    }

    // Trade-in timing. Used buyers come back sooner than new buyers; unknown
    // condition uses the new-car timing (the more conservative of the two).
    const [approaching, due] = condition === 'used' ? [12, 18] : [24, 36];
    if (monthsSince >= due) {
      score += POINTS.timingDue;
      reasons.push(`Bought ${vehicleText} ${formatMonths(monthsSince)} ago`);
    } else if (monthsSince >= approaching) {
      score += POINTS.timingApproaching;
      reasons.push(`Bought ${vehicleText} ${formatMonths(monthsSince)} ago`);
    }

    // Loyalty only counts once the latest purchase has settled in.
    if (custSales.length >= 2 && monthsSince >= 6) {
      score += POINTS.repeatBuyer;
      reasons.push(`Repeat buyer (${custSales.length} purchases)`);
    }

    const bm = custSales.map(s => birthMonth(s.birthday)).find(m => m !== null);
    if (bm !== undefined && bm === now.getMonth() && monthsSince >= 12) {
      score += POINTS.birthday;
      reasons.push('Birthday this month');
    }

    const tier: Tier | null = recent.length ? 'hot' : score >= WARM_MIN ? 'warm' : score >= WATCH_MIN ? 'watch' : null;
    if (!tier) continue;

    // When the last sale lacks contact info, borrow it from another sale of theirs.
    const withPhone = custSales.find(s => s.customer_phone);
    const withEmail = custSales.find(s => s.customer_email);
    prospects.push({
      key,
      name: custSales.map(s => s.customer_full_name?.trim()).find(Boolean) ?? 'Unknown',
      phone: withPhone?.customer_phone ?? null,
      email: withEmail?.customer_email ?? null,
      tier,
      score,
      reasons,
      lastSaleDate: last.sale_date!,
      lastVehicle,
      condition,
      salesperson: last.salesperson,
      monthsSince,
      purchases: custSales.length,
      recentLeadDate: recent.length ? new Date(recent[0].t).toISOString() : null,
      recentLeadVendorIds: recentVendorIds,
      interestedIn,
    });
  }

  prospects.sort((a, b) => b.score - a.score || b.monthsSince - a.monthsSince);
  const vendors = [...vendorStats.values()].sort((a, b) => b.returning - a.returning || b.leads - a.leads);
  return { prospects, vendors };
}
