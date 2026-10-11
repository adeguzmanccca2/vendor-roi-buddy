// When a vendor's monthly cost counts.
//
// Active vendor: every month. Deactivated vendor: up to and including the
// month of its last lead, then nothing -- once leads stop coming in you're no
// longer paying for it. A deactivated vendor that never sent a lead costs
// nothing in any month. Sales credited to it keep counting regardless (leads
// can take months to close); only the cost stops.
//
// Months are UTC YYYY-MM, matching saleMonthKey and the Attribution periods.
import { saleMonthKey } from './avgGross';

// 'YYYY-MM' = last month with cost; null = no end (active vendor);
// NEVER = deactivated without a single lead.
export const NEVER = '0000-00';

export function costUntil(isActive: boolean | null | undefined, lastLeadDate: string | null | undefined): string | null {
  if (isActive !== false) return null;
  return saleMonthKey(lastLeadDate) ?? NEVER;
}

export function costsInMonth(until: string | null | undefined, monthKey: string): boolean {
  return !until || monthKey <= until;
}

// UTC month keys from `start` (inclusive) to `end` (exclusive).
export function monthKeysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (d < end) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

// Latest lead date for each of the given (deactivated) vendors. One small
// query per vendor -- there are only a handful, and a single "all leads"
// query would hit PostgREST's 1000-row cap for busy dealerships.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchLastLeadDates(db: any, organizationId: string, vendorIds: string[]): Promise<Record<string, string | null>> {
  const entries = await Promise.all(vendorIds.map(async id => {
    const { data } = await db
      .from('leads')
      .select('lead_date')
      .eq('organization_id', organizationId)
      .eq('vendor_id', id)
      .not('lead_date', 'is', null)
      .order('lead_date', { ascending: false })
      .limit(1);
    return [id, (data?.[0]?.lead_date as string | undefined) ?? null] as const;
  }));
  return Object.fromEntries(entries);
}
