import { describe, expect, it } from 'vitest';
import { birthMonth, saleCondition, scoreLikelyToBuy, type LtbLead, type LtbSale } from './likelyToBuy';

const NOW = new Date('2026-10-26T12:00:00Z');

let n = 0;
function sale(over: Partial<LtbSale>): LtbSale {
  return {
    id: `s${++n}`, customer_full_name: 'Pat Doe', customer_phone: null, customer_email: null,
    normalized_phone: null, normalized_email: null, work_phone: null, home_phone: null,
    sale_date: '2025-01-15', new_used: null, vehicle_year: 2022, vehicle_make: 'Toyota',
    vehicle_model: 'Camry', vehicle_of_interest: null, salesperson: 'Sam', birthday: null,
    ...over,
  };
}
function lead(over: Partial<LtbLead>): LtbLead {
  return {
    id: `l${++n}`, vendor_id: 'v1', lead_date: '2026-10-20', created_at: '2026-10-20',
    normalized_phone: null, normalized_email: null, customer_phone: null, customer_email: null,
    vehicle_year: null, vehicle_make: null, vehicle_model: null, vehicle_of_interest: null,
    ...over,
  };
}

describe('saleCondition', () => {
  it('prefers the new_used column', () => {
    expect(saleCondition({ new_used: 'USED', vehicle_year: 2026, sale_date: '2026-01-01' })).toBe('used');
    expect(saleCondition({ new_used: 'N', vehicle_year: 2015, sale_date: '2026-01-01' })).toBe('new');
  });
  it('infers from model year when the column is empty', () => {
    expect(saleCondition({ new_used: null, vehicle_year: 2019, sale_date: '2025-03-01' })).toBe('used');
    expect(saleCondition({ new_used: null, vehicle_year: 2025, sale_date: '2025-03-01' })).toBe('new');
    expect(saleCondition({ new_used: null, vehicle_year: null, sale_date: '2025-03-01' })).toBeNull();
  });
});

describe('birthMonth', () => {
  it('reads ISO and US formats', () => {
    expect(birthMonth('1980-10-05')).toBe(9);
    expect(birthMonth('10/05/1980')).toBe(9);
    expect(birthMonth('garbage')).toBeNull();
  });
});

describe('scoreLikelyToBuy', () => {
  it('a past buyer with a new lead is Hot, matched by phone', () => {
    const { prospects } = scoreLikelyToBuy(
      [sale({ normalized_phone: '5551234567', sale_date: '2025-06-01' })],
      [lead({ normalized_phone: '5551234567', vehicle_make: 'Toyota', vehicle_model: 'Highlander' })],
      NOW,
    );
    expect(prospects).toHaveLength(1);
    expect(prospects[0].tier).toBe('hot');
    expect(prospects[0].interestedIn).toBe('Toyota Highlander');
    expect(prospects[0].reasons[0]).toMatch(/New lead on 10\/20/);
  });

  it('ignores the lead that produced the sale', () => {
    const { prospects } = scoreLikelyToBuy(
      [sale({ normalized_email: 'a@b.com', sale_date: '2026-10-22' })],
      [lead({ normalized_email: 'a@b.com', lead_date: '2026-10-20' })],
      NOW,
    );
    expect(prospects).toHaveLength(0);
  });

  it('never matches on name alone', () => {
    const { prospects } = scoreLikelyToBuy(
      [sale({ customer_full_name: 'John Smith', normalized_phone: '5550000001', sale_date: '2026-06-01' })],
      [lead({ normalized_phone: '5550000002' })],
      NOW,
    );
    expect(prospects).toHaveLength(0);
  });

  it('used buyers are Warm at 18+ months, new buyers only approaching at 24', () => {
    const { prospects } = scoreLikelyToBuy(
      [
        sale({ normalized_phone: '5550000010', new_used: 'USED', sale_date: '2025-03-01' }),
        sale({ normalized_phone: '5550000011', new_used: 'NEW', sale_date: '2024-09-01' }),
        sale({ normalized_phone: '5550000012', new_used: 'NEW', sale_date: '2026-01-01' }),
      ],
      [],
      NOW,
    );
    const byPhone = (p: string) => prospects.find(x => x.key === `p:${p}`);
    expect(byPhone('5550000010')?.tier).toBe('warm');
    expect(byPhone('5550000011')?.tier).toBe('watch');
    expect(byPhone('5550000012')).toBeUndefined();
  });

  it('joins sales into one customer through shared phone or email', () => {
    const { prospects } = scoreLikelyToBuy(
      [
        sale({ normalized_phone: '5550000020', sale_date: '2023-01-01' }),
        sale({ normalized_phone: '5550000020', normalized_email: 'x@y.com', sale_date: '2025-02-01' }),
      ],
      [],
      NOW,
    );
    expect(prospects).toHaveLength(1);
    expect(prospects[0].purchases).toBe(2);
    expect(prospects[0].reasons).toContain('Repeat buyer (2 purchases)');
  });

  it('flags several leads across vendors', () => {
    const { prospects } = scoreLikelyToBuy(
      [sale({ normalized_phone: '5550000030', sale_date: '2024-01-01' })],
      [
        lead({ normalized_phone: '5550000030', vendor_id: 'v1', lead_date: '2026-10-10' }),
        lead({ normalized_phone: '5550000030', vendor_id: 'v2', lead_date: '2026-10-20' }),
      ],
      NOW,
    );
    expect(prospects[0].recentLeadVendorIds.sort()).toEqual(['v1', 'v2']);
    expect(prospects[0].reasons).toContain('2 leads in the last 30 days');
    expect(prospects[0].reasons).toContain('Shopping on 2 lead sources');
  });

  it('counts returning-customer leads per vendor', () => {
    const { vendors } = scoreLikelyToBuy(
      [sale({ normalized_phone: '5550000040', sale_date: '2024-01-01' })],
      [
        lead({ normalized_phone: '5550000040', vendor_id: 'v1' }),
        lead({ normalized_phone: '5559999999', vendor_id: 'v1' }),
        lead({ normalized_phone: '5559999998', vendor_id: 'v2' }),
      ],
      NOW,
    );
    expect(vendors.find(v => v.vendorId === 'v1')).toEqual({ vendorId: 'v1', leads: 2, returning: 1 });
    expect(vendors.find(v => v.vendorId === 'v2')).toEqual({ vendorId: 'v2', leads: 1, returning: 0 });
  });
});
