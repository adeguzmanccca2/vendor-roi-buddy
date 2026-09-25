import { describe, expect, it } from 'vitest';
import { DEFAULT_AVG_GROSS, avgGrossForSale, saleMonthKey } from './avgGross';

describe('avgGrossForSale', () => {
  const byMonth = { '2026-08': 3500 };

  it('uses the stored value for the month the sale closed', () => {
    expect(avgGrossForSale('2026-08-15T12:00:00+00:00', byMonth)).toBe(3500);
  });

  it('falls back to the default for months with no stored value', () => {
    expect(avgGrossForSale('2026-09-02T12:00:00+00:00', byMonth)).toBe(DEFAULT_AVG_GROSS);
  });

  it('uses the default when the sale has no date', () => {
    expect(avgGrossForSale(null, byMonth)).toBe(DEFAULT_AVG_GROSS);
  });

  it('keys months in UTC, matching the period filter', () => {
    expect(saleMonthKey('2026-09-01T00:00:00+00:00')).toBe('2026-09');
    expect(saleMonthKey('2026-08-31T23:59:59+00:00')).toBe('2026-08');
  });
});
