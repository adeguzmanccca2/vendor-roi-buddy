import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { AttributionOverrideDialog } from '@/components/AttributionOverrideDialog';
import { AttributionBadge } from '@/pages/Attribution';

interface Vendor { id: string; name: string }
interface SaleRow {
  id: string; vendor_id: string | null; lead_id: string | null;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  organization_id: string;
  sale_date: string | null;
  sale_price: number | null;
  attribution_status: string; attribution_confidence: number | null;
  manual_override: boolean;
  vehicle_year: number | null; vehicle_make: string | null; vehicle_model: string | null;
  vin: string | null; stock_number: string | null;
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function FixAttributionPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [overrideSale, setOverrideSale] = useState<SaleRow | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    try {
      const [{ data: v, error: vErr }, { data: s, error: sErr }] = await Promise.all([
        supabase.from('vendors').select('id, name').eq('organization_id', activeOrgId).order('name'),
        supabase
          .from('sales')
          .select('id, vendor_id, lead_id, customer_full_name, customer_email, customer_phone, normalized_email, normalized_phone, organization_id, sale_date, sale_price, attribution_status, attribution_confidence, manual_override, vehicle_year, vehicle_make, vehicle_model, vin, stock_number')
          .eq('organization_id', activeOrgId)
          .order('sale_date', { ascending: false, nullsFirst: false })
          .limit(500),
      ]);
      if (vErr) throw vErr;
      if (sErr) throw sErr;
      setVendors((v ?? []) as Vendor[]);
      setSales((s ?? []) as SaleRow[]);
    } catch (e: any) {
      toast.error('Failed to load: ' + (e.message ?? 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeOrgId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter(s => [
      s.customer_full_name, s.customer_email, s.customer_phone, s.vin, s.stock_number,
    ].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [sales, search]);

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2">
            <Link to="/attribution"><ArrowLeft className="mr-1 h-4 w-4" /> Back to Attribution</Link>
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Fix Attribution</h1>
          <p className="text-sm text-muted-foreground">
            {activeOrg?.name} — manually assign a vendor and/or lead to a sale.
          </p>
        </div>
        <Input
          placeholder="Search customer, email, phone, VIN, stock #..."
          className="w-72"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Sales ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No sales found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Customer</th>
                  <th className="px-4 py-2 text-left">Vehicle</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Gross</th>
                  <th className="px-4 py-2 text-center">Attribution</th>
                  <th className="px-4 py-2 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-b">
                    <td className="px-4 py-2">{s.customer_full_name ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {[s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">{fmtMoney(Number(s.sale_price ?? 0))}</td>
                    <td className="px-4 py-2 text-center">
                      <AttributionBadge status={s.attribution_status} confidence={s.attribution_confidence ?? 0} manual={s.manual_override} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Button variant="ghost" size="sm" onClick={() => { setOverrideSale(s); setOverrideOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <AttributionOverrideDialog
        sale={overrideSale}
        vendors={vendors}
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        onSaved={load}
      />
    </div>
  );
}
