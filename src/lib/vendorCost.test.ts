import { describe, expect, it } from 'vitest';
import { costsInMonth, costUntil, monthKeysBetween, NEVER } from './vendorCost';

describe('vendor cost window', () => {
  it('active vendors cost every month', () => {
    expect(costUntil(true, '2026-05-10T04:00:00Z')).toBeNull();
    expect(costsInMonth(null, '2030-01')).toBe(true);
  });

  it('a deactivated vendor costs through the month of its last lead', () => {
    const until = costUntil(false, '2026-08-20T04:00:00Z');
    expect(until).toBe('2026-08');
    expect(costsInMonth(until, '2026-08')).toBe(true);
    expect(costsInMonth(until, '2026-09')).toBe(false);
    expect(costsInMonth(until, '2026-01')).toBe(true);
  });

  it('a deactivated vendor with no leads never costs anything', () => {
    expect(costUntil(false, null)).toBe(NEVER);
    expect(costsInMonth(NEVER, '2020-01')).toBe(false);
  });

  it('lists UTC months in a range', () => {
    expect(monthKeysBetween(new Date('2026-07-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z')))
      .toEqual(['2026-07', '2026-08', '2026-09']);
  });
});
