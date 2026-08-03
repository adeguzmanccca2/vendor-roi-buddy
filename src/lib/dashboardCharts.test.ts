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

    expect(data.series.map(s => s.key)).toEqual(['attributedSales', 'vendor:v1', 'vendor:v2']);
    expect(data.data).toEqual([
      { month: previousMonth, attributedSales: 1, 'vendor:v1': 1, 'vendor:v2': 1 },
      { month: currentMonth, attributedSales: 1, 'vendor:v1': 1, 'vendor:v2': 0 },
    ]);
  });
});

describe('buildVendorRoiTrend', () => {
  it('computes monthly ROI per vendor with cost data, matching sales via email/phone/vin/stock', () => {
    const now = new Date();
    const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 5);
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 5);
    const previousMonth = `${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}/${String(previousMonthDate.getFullYear()).slice(2)}`;
    const currentMonth = `${String(currentMonthDate.getMonth() + 1).padStart(2, '0')}/${String(currentMonthDate.getFullYear()).slice(2)}`;

    const trend = buildVendorRoiTrend({
      leads: [
        { vendor_id: 'v1', customer_email: 'buyer@example.com' },
      ],
      sales: [
        // matched via email to v1: revenue 3000, cost 1000 -> ROI 200%
        { sale_date: previousMonthDate.toISOString().slice(0, 10), normalized_email: 'buyer@example.com', sale_price: 3000 },
        // no match this month -> ROI -100% (all cost, no revenue)
      ],
      vendors: [
        { id: 'v1', name: 'Acme', monthly_cost: 1000 },
        { id: 'v2', name: 'No Cost Vendor', monthly_cost: 0 },
      ],
      months: 2,
    });

    expect(trend.series.map(s => s.key)).toEqual(['vendor:v1']);
    expect(trend.data).toEqual([
      { month: previousMonth, 'vendor:v1': 200 },
      { month: currentMonth, 'vendor:v1': -100 },
    ]);
  });
});
