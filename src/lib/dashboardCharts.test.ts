import { describe, expect, it } from 'vitest';

import { buildVendorComparisonData, buildVendorRoiTrend } from './dashboardCharts';

describe('buildVendorComparisonData', () => {
  it('builds monthly vendor lead counts and attributed sales series', () => {
    const now = new Date();
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 5);
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 5);
    const previousMonth = `${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}/${String(previousMonthDate.getFullYear()).slice(2)}`;
    const currentMonth = `${String(currentMonthDate.getMonth() + 1).padStart(2, '0')}/${String(currentMonthDate.getFullYear()).slice(2)}`;

    const data = buildVendorComparisonData({
      leads: [
        { lead_date: previousMonthDate.toISOString().slice(0, 10), vendor_id: 'v1' },
        { lead_date: previousMonthDate.toISOString().slice(0, 10), vendor_id: 'v2' },
        { lead_date: currentMonthDate.toISOString().slice(0, 10), vendor_id: 'v1' },
      ],
      sales: [
        { sale_date: previousMonthDate.toISOString().slice(0, 10), vendor_id: 'v1', lead_id: null },
        { sale_date: currentMonthDate.toISOString().slice(0, 10), vendor_id: null, lead_id: 'lead-1' },
      ],
      vendors: [
        { id: 'v1', name: 'Acme' },
        { id: 'v2', name: 'Best Auto' },
      ],
      months: 2,
    });

    expect(data.series.map(s => s.key)).toEqual(['attributedSales', 'totalLeads', 'vendor:v1', 'vendor:v2']);
    expect(data.data).toEqual([
      { month: previousMonth, attributedSales: 1, totalLeads: 2, 'vendor:v1': 1, 'vendor:v2': 1 },
      { month: currentMonth, attributedSales: 1, totalLeads: 1, 'vendor:v1': 1, 'vendor:v2': 0 },
    ]);
  });
});

describe('buildVendorRoiTrend', () => {
  it('computes monthly ROI per vendor from stored sale_attributions credits', () => {
    const now = new Date();
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 5);
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 5);
    const previousMonth = `${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}/${String(previousMonthDate.getFullYear()).slice(2)}`;
    const currentMonth = `${String(currentMonthDate.getMonth() + 1).padStart(2, '0')}/${String(currentMonthDate.getFullYear()).slice(2)}`;

    const trend = buildVendorRoiTrend({
      sales: [
        // credited to v1: revenue 3000, cost 1000 -> ROI 200%
        { id: 'sale-1', sale_date: previousMonthDate.toISOString().slice(0, 10), sale_price: 3000 },
        // no credit this month -> ROI -100% (all cost, no revenue)
      ],
      vendors: [
        { id: 'v1', name: 'Acme', monthly_cost: 1000 },
        { id: 'v2', name: 'No Cost Vendor', monthly_cost: 0 },
      ],
      creditsBySaleId: new Map([['sale-1', ['v1']]]),
      months: 2,
    });

    expect(trend.series.map(s => s.key)).toEqual(['vendor:v1']);
    expect(trend.data).toEqual([
      { month: previousMonth, 'vendor:v1': 200 },
      { month: currentMonth, 'vendor:v1': -100 },
    ]);
  });

  it('gives each credited vendor full revenue when a sale is credited to several', () => {
    const now = new Date();
    const thisMonthDate = new Date(now.getFullYear(), now.getMonth(), 5);
    const thisMonth = `${String(thisMonthDate.getMonth() + 1).padStart(2, '0')}/${String(thisMonthDate.getFullYear()).slice(2)}`;

    const trend = buildVendorRoiTrend({
      sales: [
        { id: 'sale-1', sale_date: thisMonthDate.toISOString().slice(0, 10), sale_price: 2000 },
      ],
      vendors: [
        { id: 'v1', name: 'Acme', monthly_cost: 1000 },
        { id: 'v2', name: 'Beta', monthly_cost: 1000 },
      ],
      // The multi-vendor model: both vendors legitimately claim this sale, so
      // both get the full 2000 rather than 1000 each.
      creditsBySaleId: new Map([['sale-1', ['v1', 'v2']]]),
      months: 1,
    });

    expect(trend.data).toEqual([
      { month: thisMonth, 'vendor:v1': 100, 'vendor:v2': 100 },
    ]);
  });

  it('ignores credits pointing at vendors that no longer exist', () => {
    const now = new Date();
    const thisMonthDate = new Date(now.getFullYear(), now.getMonth(), 5);
    const thisMonth = `${String(thisMonthDate.getMonth() + 1).padStart(2, '0')}/${String(thisMonthDate.getFullYear()).slice(2)}`;

    const trend = buildVendorRoiTrend({
      sales: [
        { id: 'sale-1', sale_date: thisMonthDate.toISOString().slice(0, 10), sale_price: 5000 },
      ],
      vendors: [{ id: 'v1', name: 'Acme', monthly_cost: 1000 }],
      creditsBySaleId: new Map([['sale-1', ['deleted-vendor']]]),
      months: 1,
    });

    // Revenue is not silently handed to the surviving vendor.
    expect(trend.data).toEqual([{ month: thisMonth, 'vendor:v1': -100 }]);
  });
});
