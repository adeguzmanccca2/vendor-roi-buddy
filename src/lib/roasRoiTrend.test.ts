import { describe, expect, it } from 'vitest';
import { buildRoasRoiTrend } from './dashboardCharts';

describe('buildRoasRoiTrend', () => {
  const now = new Date(Date.UTC(2026, 8, 15)); // Sep 2026
  const vendors = [{ id: 'v1', monthly_cost: 1000 }, { id: 'v2', monthly_cost: 1000 }, { id: 'v3', monthly_cost: null }];
  const credits = new Map([['s1', ['v1']], ['s2', ['v1', 'v2']]]);

  it('computes ROAS on net and ROI on net + avg gross x sales', () => {
    const data = buildRoasRoiTrend({
      sales: [
        { id: 's1', sale_date: '2026-09-02T12:00:00+00:00', sale_price: 3000 },
        { id: 's2', sale_date: '2026-09-10T12:00:00+00:00', sale_price: 1000 },
        // Unassigned: not credited to any vendor, so ignored.
        { id: 's3', sale_date: '2026-09-11T12:00:00+00:00', sale_price: 99999 },
      ],
      vendors,
      creditsBySaleId: credits,
      avgGrossByMonth: { '2026-09': 2000 },
      now,
    });
    const sep = data[data.length - 1];
    expect(sep.month).toBe('09/26');
    // cost 2000, net 4000 -> (4000-2000)/2000 = 100%
    expect(sep.roas).toBe(100);
    // gross 4000 + 2 x 2000 = 8000 -> 300%
    expect(sep.roi).toBe(300);
  });

  it('uses the default avg gross when a month has no stored value', () => {
    const data = buildRoasRoiTrend({
      sales: [{ id: 's1', sale_date: '2026-09-02T12:00:00+00:00', sale_price: 0 }],
      vendors,
      creditsBySaleId: credits,
      avgGrossByMonth: {},
      now,
    });
    // gross 0 + 4000 vs cost 2000 -> 100%
    expect(data[data.length - 1].roi).toBe(100);
  });

  it('leaves months with no sales or no cost blank', () => {
    const data = buildRoasRoiTrend({ sales: [], vendors, creditsBySaleId: credits, avgGrossByMonth: {}, now });
    expect(data).toHaveLength(12);
    expect(data.every(p => p.roas === null && p.roi === null)).toBe(true);
    const noCost = buildRoasRoiTrend({
      sales: [{ id: 's1', sale_date: '2026-09-02T12:00:00+00:00', sale_price: 5000 }],
      vendors: [], creditsBySaleId: credits, avgGrossByMonth: {}, now,
    });
    expect(noCost[noCost.length - 1].roas).toBeNull();
  });
});

describe('buildVendorRoiTrend with avg gross', () => {
  it('adds the month avg gross per credited sale when avgGrossByMonth is given', async () => {
    const { buildVendorRoiTrend } = await import('./dashboardCharts');
    const args = {
      sales: [{ id: 's1', sale_date: new Date().toISOString(), sale_price: 1000 }],
      vendors: [{ id: 'v1', name: 'V', monthly_cost: 1000 }],
      creditsBySaleId: new Map([['s1', ['v1']]]),
      months: 1,
    };
    // Net: (1000 - 1000) / 1000 = 0%; gross: (1000 + 4000 - 1000) / 1000 = 400%
    expect(buildVendorRoiTrend(args).data[0]['vendor:v1']).toBe(0);
    expect(buildVendorRoiTrend({ ...args, avgGrossByMonth: {} }).data[0]['vendor:v1']).toBe(400);
  });
});

describe('buildRevenueTrend', () => {
  it('sums every sale per month: net, avg gross x vehicles, gross', async () => {
    const { buildRevenueTrend } = await import('./dashboardCharts');
    const data = buildRevenueTrend({
      sales: [
        { sale_date: '2026-09-02T12:00:00+00:00', sale_price: 30000 },
        { sale_date: '2026-09-20T12:00:00+00:00', sale_price: 20000 },
        { sale_date: '2026-08-05T12:00:00+00:00', sale_price: 10000 },
      ],
      avgGrossByMonth: { '2026-08': 3500 },
      now: new Date(Date.UTC(2026, 8, 15)),
    });
    expect(data).toHaveLength(12);
    expect(data[11]).toEqual({ month: '09/26', vehicles: 2, net: 50000, avgGrossAdded: 8000, gross: 58000 });
    expect(data[10]).toEqual({ month: '08/26', vehicles: 1, net: 10000, avgGrossAdded: 3500, gross: 13500 });
    expect(data[0].vehicles).toBe(0);
  });
});
