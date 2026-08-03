import { describe, expect, it } from 'vitest';

import { getMatchingVendorIds } from './attributionMatching';

describe('getMatchingVendorIds', () => {
  it('matches sales to vendors using normalized email and phone values', () => {
    const knownVendorIds = new Set(['vendor-1', 'vendor-2']);
    const leads = [
      { vendor_id: 'vendor-1', customer_email: 'buyer@example.com', customer_phone: '(555) 123-4567' },
      { vendor_id: 'vendor-2', customer_email: 'other@example.com', customer_phone: '555-987-6543' },
    ];

    const sale = {
      normalized_email: 'BUYER@EXAMPLE.COM',
      normalized_phone: '5551234567',
    };

    expect(getMatchingVendorIds({ sale, knownVendorIds, leads })).toEqual(['vendor-1']);
  });

  it('prefers VIN and stock matches over email and phone matches', () => {
    const knownVendorIds = new Set(['vendor-1', 'vendor-2']);
    const leads = [
      { vendor_id: 'vendor-1', vin: 'abc123', customer_email: 'buyer@example.com' },
      { vendor_id: 'vendor-2', stock_number: 'stock-99', customer_phone: '555-111-2222' },
    ];

    const sale = {
      vin: 'ABC123',
      normalized_email: 'buyer@example.com',
      normalized_phone: '5551112222',
    };

    expect(getMatchingVendorIds({ sale, knownVendorIds, leads })).toEqual(['vendor-1']);
  });
});
