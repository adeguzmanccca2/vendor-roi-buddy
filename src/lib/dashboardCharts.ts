import { avgGrossForSale, saleMonthKey } from './avgGross';


export interface VendorComparisonLead {
  lead_date?: string | null;
  vendor_id?: string | null;
}

export interface VendorComparisonSale {
  sale_date?: string | null;
  vendor_id?: string | null;
  lead_id?: string | null;
}

export interface VendorComparisonVendor {
  id: string;
  name: string;
}

export interface VendorComparisonSeries {
  key: string;
  label: string;
  color: string;
}

export interface VendorComparisonPoint {
  month: string;
  attributedSales: number;
  totalLeads: number;
  [key: string]: number | string;
}

const palette = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))',
  'hsl(var(--chart-5))', 'hsl(var(--chart-6))', 'hsl(var(--chart-7))', 'hsl(var(--chart-8))',
];

export function buildVendorComparisonData({
  leads,
  sales,
  vendors,
  months = 12,
  now = new Date(),
}: {
  leads: VendorComparisonLead[];
  sales: VendorComparisonSale[];
  vendors: VendorComparisonVendor[];
  months?: number;
  // Last month of the window (any day in it); the window runs `months` back.
  now?: Date;
}) {
  const buckets: Record<string, VendorComparisonPoint> = {};

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const month = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
    buckets[key] = { month, attributedSales: 0, totalLeads: 0 };
  }

  const series: VendorComparisonSeries[] = [
    { key: 'attributedSales', label: 'Attributed sales', color: 'hsl(var(--muted-foreground))' },
    { key: 'totalLeads', label: 'Total leads', color: 'hsl(var(--foreground))' },
    ...vendors.map((vendor, index) => ({
      key: `vendor:${vendor.id}`,
      label: vendor.name,
      color: palette[index % palette.length],
    })),
  ];

  for (const point of Object.values(buckets)) {
    for (const vendor of vendors) {
      point[`vendor:${vendor.id}`] = 0;
    }
  }

  for (const vendor of vendors) {
    const key = `vendor:${vendor.id}`;
    for (const lead of leads) {
      if (!lead.lead_date || !lead.vendor_id || lead.vendor_id !== vendor.id) continue;
      const d = new Date(lead.lead_date);
      const bucketKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (bucketKey in buckets) {
        const point = buckets[bucketKey] as VendorComparisonPoint;
        point[key] = (Number(point[key] ?? 0) + 1) as number;
        point.totalLeads += 1;
      }
    }
  }

  for (const sale of sales) {
    if (!sale.sale_date || (!sale.vendor_id && !sale.lead_id)) continue;
    const d = new Date(sale.sale_date);
    const bucketKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (bucketKey in buckets) {
      const point = buckets[bucketKey] as VendorComparisonPoint;
      point.attributedSales = (Number(point.attributedSales ?? 0) + 1) as number;
    }
  }

  return {
    data: Object.values(buckets),
    series,
  };
}

export interface VendorRoiTrendSale {
  id: string;
  sale_date?: string | null;
  sale_price?: number | null;
}

export interface VendorRoiTrendVendor {
  id: string;
  name: string;
  monthly_cost: number | null;
}

export interface VendorRoiTrendPoint {
  month: string;
  [key: string]: number | string;
}

// ROI trend reads the STORED credits in sale_attributions rather than
// re-deriving matches here. Previously this ran its own copy of the
// VIN/stock/email/phone matching, which meant the chart could disagree with
// what the matcher had actually recorded -- different rules, different answer,
// same screen. `creditsBySaleId` maps a sale id to every vendor credited for
// it; a sale credited to several vendors is split equally between them,
// exactly as the Vendor performance table does.
export function buildVendorRoiTrend({
  sales,
  vendors,
  creditsBySaleId,
  months = 12,
  avgGrossByMonth,
}: {
  sales: VendorRoiTrendSale[];
  vendors: VendorRoiTrendVendor[];
  creditsBySaleId: Map<string, string[]>;
  months?: number;
  // When given, ROI is on gross revenue (sale price + the month's avg gross
  // per vehicle); without it, on sale price alone.
  avgGrossByMonth?: Record<string, number>;
}) {
  const now = new Date();
  const bucketKeys: string[] = [];
  const buckets: Record<string, VendorRoiTrendPoint> = {};

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const month = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
    bucketKeys.push(key);
    buckets[key] = { month };
  }

  const vendorsWithCost = vendors.filter(v => Number(v.monthly_cost ?? 0) > 0);
  const series: VendorComparisonSeries[] = vendorsWithCost.map((vendor, index) => ({
    key: `vendor:${vendor.id}`,
    label: vendor.name,
    color: palette[index % palette.length],
  }));

  const knownVendorIds = new Set(vendors.map(v => v.id));

  const revenueByBucketVendor = new Map<string, Map<string, number>>();
  for (const sale of sales) {
    if (!sale.sale_date) continue;
    const d = new Date(sale.sale_date);
    const bucketKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!(bucketKey in buckets)) continue;

    const matches = (creditsBySaleId.get(sale.id) ?? []).filter(id => knownVendorIds.has(id));
    if (matches.length === 0) continue;

    const byVendor = revenueByBucketVendor.get(bucketKey) ?? new Map<string, number>();
    for (const vendorId of matches) {
      const saleValue = (Number(sale.sale_price ?? 0)
        + (avgGrossByMonth ? avgGrossForSale(sale.sale_date, avgGrossByMonth) : 0)) / matches.length;
      byVendor.set(vendorId, (byVendor.get(vendorId) ?? 0) + saleValue);
    }
    revenueByBucketVendor.set(bucketKey, byVendor);
  }

  for (const key of bucketKeys) {
    const point = buckets[key];
    const byVendor = revenueByBucketVendor.get(key);
    for (const vendor of vendorsWithCost) {
      const cost = Number(vendor.monthly_cost ?? 0);
      const revenue = byVendor?.get(vendor.id) ?? 0;
      point[`vendor:${vendor.id}`] = Math.round(((revenue - cost) / cost) * 100);
    }
  }

  return {
    data: bucketKeys.map(key => buckets[key]),
    series,
  };
}

export interface RoasRoiTrendSale {
  id: string;
  sale_date: string | null;
  sale_price: number | null;
}

export interface RoasRoiTrendPoint {
  month: string;
  // Percentages, null for a month with no cost or no sales (drawn as a gap
  // rather than a misleading -100%).
  roas: number | null;
  roi: number | null;
}

// Dealership-wide ROAS and ROI per month, same formulas as the Vendor
// performance table:
//   ROAS = (net revenue - cost) / cost
//   ROI  = (gross revenue - cost) / cost,  gross = net + avg gross x sales
// Revenue counts only sales credited to one of the given vendors (like the
// Overall ROI card -- Unassigned sales earned nothing for any vendor), cost
// is the summed monthly_cost of those vendors, and avg gross is the month's
// stored value or DEFAULT_AVG_GROSS. Months are UTC, matching the
// Attribution period filter and the avg gross months.
export function buildRoasRoiTrend({
  sales,
  vendors,
  creditsBySaleId,
  avgGrossByMonth,
  months = 12,
  now = new Date(),
}: {
  sales: RoasRoiTrendSale[];
  vendors: { id: string; monthly_cost: number | null }[];
  creditsBySaleId: Map<string, string[]>;
  avgGrossByMonth: Record<string, number>;
  months?: number;
  now?: Date;
}): RoasRoiTrendPoint[] {
  const monthlyCost = vendors.reduce((a, v) => a + Number(v.monthly_cost ?? 0), 0);

  const keys: string[] = [];
  const agg: Record<string, { net: number; gross: number; sales: number }> = {};
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    keys.push(key);
    agg[key] = { net: 0, gross: 0, sales: 0 };
  }

  const vendorIds = new Set(vendors.map(v => v.id));
  for (const s of sales) {
    const key = saleMonthKey(s.sale_date);
    if (!key || !(key in agg)) continue;
    if (!(creditsBySaleId.get(s.id) ?? []).some(id => vendorIds.has(id))) continue;
    const net = Number(s.sale_price ?? 0);
    agg[key].net += net;
    agg[key].gross += net + avgGrossForSale(s.sale_date, avgGrossByMonth);
    agg[key].sales += 1;
  }

  return keys.map(key => {
    const a = agg[key];
    const usable = monthlyCost > 0 && a.sales > 0;
    return {
      month: `${key.slice(5)}/${key.slice(2, 4)}`,
      roas: usable ? Math.round(((a.net - monthlyCost) / monthlyCost) * 100) : null,
      roi: usable ? Math.round(((a.gross - monthlyCost) / monthlyCost) * 100) : null,
    };
  });
}

export interface RevenueTrendPoint {
  month: string;
  vehicles: number;
  net: number;
  // avg gross per vehicle x vehicles: the part that turns net into gross.
  avgGrossAdded: number;
  gross: number;
}

// Dealership revenue per month, every sale (no attribution): net = sale
// prices, gross = net + the month's avg gross per vehicle x vehicles sold.
// Same numbers as the Gross Revenue cards. Months are UTC.
export function buildRevenueTrend({
  sales,
  avgGrossByMonth,
  months = 12,
  now = new Date(),
}: {
  sales: { sale_date: string | null; sale_price: number | null }[];
  avgGrossByMonth: Record<string, number>;
  months?: number;
  now?: Date;
}): RevenueTrendPoint[] {
  const keys: string[] = [];
  const agg: Record<string, { vehicles: number; net: number; added: number }> = {};
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    keys.push(key);
    agg[key] = { vehicles: 0, net: 0, added: 0 };
  }
  for (const s of sales) {
    const key = saleMonthKey(s.sale_date);
    if (!key || !(key in agg)) continue;
    agg[key].vehicles += 1;
    agg[key].net += Number(s.sale_price ?? 0);
    agg[key].added += avgGrossForSale(s.sale_date, avgGrossByMonth);
  }
  return keys.map(key => {
    const a = agg[key];
    return {
      month: `${key.slice(5)}/${key.slice(2, 4)}`,
      vehicles: a.vehicles,
      net: Math.round(a.net),
      avgGrossAdded: Math.round(a.added),
      gross: Math.round(a.net + a.added),
    };
  });
}
