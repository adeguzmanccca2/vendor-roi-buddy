import { describe, expect, it } from 'vitest';
import { resolveLeadCount, resolveLeadTotal } from './manualLeadCounts';

describe('resolveLeadCount', () => {
  it('uses manual parts and service totals when present', () => {
    expect(resolveLeadCount({
      vendorId: 'vendor-1',
      manualLeadCounts: { 'vendor-1': { parts: 4, service: 6 } },
      fallbackLeadCount: 10,
    })).toBe(10);
  });

  it('falls back to the imported lead count when no manual values exist', () => {
    expect(resolveLeadCount({
      vendorId: 'vendor-2',
      manualLeadCounts: {},
      fallbackLeadCount: 8,
    })).toBe(8);
  });
});

describe('resolveLeadTotal', () => {
  it('sums manual vendor totals and includes unassigned fallback leads', () => {
    expect(resolveLeadTotal({
      manualLeadCounts: { 'vendor-1': { parts: 2, service: 3 } },
      vendorIds: ['vendor-1', 'vendor-2'],
      fallbackCountsByVendor: { 'vendor-1': 5, 'vendor-2': 4 },
      fallbackUnassignedCount: 1,
    })).toBe(10);
  });
});
