import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface Vendor { id: string; name: string }
interface LeadOption {
  id: string;
  customer_full_name: string | null;
  customer_email: string | null;
  vendor_id: string | null;
  lead_date: string | null;
}

interface Sale {
  id: string;
  vendor_id: string | null;
  lead_id: string | null;
  customer_full_name: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  organization_id: string;
}

const NONE = '__none__';

export function AttributionOverrideDialog({
  sale,
  vendors,
  open,
  onOpenChange,
  onSaved,
}: {
  sale: Sale | null;
  vendors: Vendor[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [vendorId, setVendorId] = useState<string>(NONE);
  const [leadId, setLeadId] = useState<string>(NONE);
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sale) return;
    setVendorId(sale.vendor_id ?? NONE);
    setLeadId(sale.lead_id ?? NONE);
    setSearch('');
  }, [sale?.id]);

  // Suggest matching leads (by email/phone, then by name search)
  useEffect(() => {
    if (!sale || !open) return;
    const run = async () => {
      let q = supabase
        .from('leads')
        .select('id, customer_full_name, customer_email, vendor_id, lead_date')
        .eq('organization_id', sale.organization_id)
        .order('lead_date', { ascending: false })
        .limit(50);

      const term = search.trim();
      if (term) {
        q = q.ilike('customer_full_name', `%${term}%`);
      } else if (sale.normalized_email) {
        q = q.eq('normalized_email', sale.normalized_email);
      } else if (sale.normalized_phone) {
        q = q.eq('normalized_phone', sale.normalized_phone);
      } else if (sale.customer_full_name) {
        q = q.ilike('customer_full_name', `%${sale.customer_full_name}%`);
      }
      const { data } = await q;
      setLeadOptions((data ?? []) as LeadOption[]);
    };
    run();
  }, [sale?.id, open, search]);

  const save = async () => {
    if (!sale) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('sales')
        .update({
          vendor_id: vendorId === NONE ? null : vendorId,
          lead_id: leadId === NONE ? null : leadId,
          attribution_status: leadId === NONE && vendorId === NONE ? 'none' : 'manual',
          attribution_confidence: 100,
          manual_override: true,
        })
        .eq('id', sale.id);
      if (error) throw error;
      toast.success('Attribution updated');
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const clearOverride = async () => {
    if (!sale) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('sales')
        .update({
          manual_override: false,
          attribution_status: 'unmatched',
          attribution_confidence: 0,
        })
        .eq('id', sale.id);
      if (error) throw error;
      toast.success('Override cleared — will re-match on next attribution run');
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? 'Clear failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual attribution</DialogTitle>
          <DialogDescription>
            {sale?.customer_full_name ?? 'Sale'} — assign a vendor and/or lead. Overrides are locked from auto re-matching.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Search leads</Label>
            <Input placeholder="Type a customer name..." value={search} onChange={e => setSearch(e.target.value)} />
            <Select value={leadId} onValueChange={(v) => {
              setLeadId(v);
              if (v !== NONE) {
                const lo = leadOptions.find(l => l.id === v);
                if (lo?.vendor_id && vendorId === NONE) setVendorId(lo.vendor_id);
              }
            }}>
              <SelectTrigger><SelectValue placeholder="Choose a lead" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— No lead —</SelectItem>
                {leadOptions.map(l => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.customer_full_name ?? l.customer_email ?? l.id.slice(0, 8)}
                    {l.lead_date ? ` · ${new Date(l.lead_date).toLocaleDateString()}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {leadOptions.length === 0 ? 'No suggested leads' : `${leadOptions.length} candidate lead(s)`}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={clearOverride} disabled={saving}>Clear override</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
