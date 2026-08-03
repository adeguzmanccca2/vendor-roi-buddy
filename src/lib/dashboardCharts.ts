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
