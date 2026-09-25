// Average gross profit per vehicle, set per dealership per month on the
// Attribution page (table avg_gross_per_vehicle). Months without a stored
// value fall back to this default.
export const DEFAULT_AVG_GROSS = 4000;

// YYYY-MM of a sale, in UTC -- the same month boundaries the Attribution
// period filter uses (periodRange builds its ranges with Date.UTC).
export function saleMonthKey(saleDate: string | null | undefined): string | null {
  if (!saleDate) return null;
  const d = new Date(saleDate);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Gross credited for one sale: the avg gross of the month it sold in.
// A sale with no date uses the default.
export function avgGrossForSale(
  saleDate: string | null | undefined,
  byMonth: Record<string, number>,
): number {
  const key = saleMonthKey(saleDate);
  return key && byMonth[key] !== undefined ? byMonth[key] : DEFAULT_AVG_GROSS;
}
