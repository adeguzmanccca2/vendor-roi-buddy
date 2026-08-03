import { buildVendorLookupMaps, getMatchingVendorIds, type AttributionLeadLike, type AttributionSaleLike } from './attributionMatching';

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
}: {
  leads: VendorComparisonLead[];
  sales: VendorComparisonSale[];
  vendors: VendorComparisonVendor[];
  months?: number;
}) {
  const now = new Date();
  const buckets: Record<string, VendorComparisonPoint> = {};

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const month = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
    buckets[key] = { month, attributedSales: 0 };
  }

  const series: VendorComparisonSeries[] = [
    { key: 'attributedSales', label: 'Attributed sales', color: 'hsl(var(--muted-foreground))' },
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

export interface VendorRoiTrendLead extends AttributionLeadLike {
  lead_date?: string | null;
}

export interface VendorRoiTrendSale extends AttributionSaleLike {
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

// ROI trend needs real attribution (VIN/stock/email/phone), unlike the lead-count
// chart above which only needs a vendor_id already set on the lead/sale.
export function buildVendorRoiTrend({
  leads,
  sales,
  vendors,
  months = 12,
}: {
  leads: VendorRoiTrendLead[];
  sales: VendorRoiTrendSale[];
  vendors: VendorRoiTrendVendor[];
  months?: number;
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
  const { vinToVendors, stockToVendors, emailToVendors, phoneToVendors } = buildVendorLookupMaps(leads);

  const revenueByBucketVendor = new Map<string, Map<string, number>>();
  for (const sale of sales) {
    if (!sale.sale_date) continue;
    const d = new Date(sale.sale_date);
    const bucketKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!(bucketKey in buckets)) continue;

    const matches = getMatchingVendorIds({
      sale, knownVendorIds, vinToVendors, stockToVendors, emailToVendors, phoneToVendors,
    });
    if (matches.length === 0) continue;

    const byVendor = revenueByBucketVendor.get(bucketKey) ?? new Map<string, number>();
    for (const vendorId of matches) {
      byVendor.set(vendorId, (byVendor.get(vendorId) ?? 0) + Number(sale.sale_price ?? 0));
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
