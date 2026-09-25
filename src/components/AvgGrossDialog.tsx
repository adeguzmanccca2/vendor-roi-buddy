import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DEFAULT_AVG_GROSS } from '@/lib/avgGross';

// avg_gross_per_vehicle isn't in the generated types.ts yet (regenerate from
// Supabase after applying 20260925000000); until then go through an untyped
// client for this one table.
const db = supabase as unknown as SupabaseClient;

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  // Months to offer for editing, as YYYY-MM (newest first).
  months: string[];
  // Stored values only; months not present use DEFAULT_AVG_GROSS.
  values: Record<string, number>;
  onSaved: (values: Record<string, number>) => void;
}

export function AvgGrossDialog({ open, onOpenChange, organizationId, months, values, onSaved }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Reset the form to the stored values every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const ym of months) next[ym] = String(values[ym] ?? DEFAULT_AVG_GROSS);
    setDraft(next);
  }, [open, months, values]);

  const invalid = useMemo(
    () => months.filter(ym => {
      const n = Number(draft[ym]);
      return draft[ym] === '' || draft[ym] === undefined || !Number.isFinite(n) || n < 0;
    }),
    [months, draft],
  );

  const save = async () => {
    if (invalid.length > 0) return toast.error('Enter a dollar amount of 0 or more for every month');
    const upserts: { organization_id: string; month: string; amount: number; updated_at: string }[] = [];
    const resets: string[] = [];
    for (const ym of months) {
      const n = Math.round(Number(draft[ym]) * 100) / 100;
      const stored = values[ym];
      if (n === DEFAULT_AVG_GROSS) {
        // Back to the default: drop the row rather than store a copy of it.
        if (stored !== undefined) resets.push(`${ym}-01`);
      } else if (n !== stored) {
        upserts.push({ organization_id: organizationId, month: `${ym}-01`, amount: n, updated_at: new Date().toISOString() });
      }
    }

    setSaving(true);
    try {
      if (upserts.length > 0) {
        const { error } = await db.from('avg_gross_per_vehicle').upsert(upserts, { onConflict: 'organization_id,month' });
        if (error) throw error;
      }
      if (resets.length > 0) {
        const { error } = await db.from('avg_gross_per_vehicle').delete()
          .eq('organization_id', organizationId).in('month', resets);
        if (error) throw error;
      }
      const next = { ...values };
      for (const u of upserts) next[u.month.slice(0, 7)] = u.amount;
      for (const r of resets) delete next[r.slice(0, 7)];
      onSaved(next);
      toast.success('Avg gross per vehicle saved');
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error('Failed to save avg gross: ' + (err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Avg gross per vehicle</DialogTitle>
          <DialogDescription>
            Gross Revenue = Net Revenue + avg gross × attributed sales, using the avg
            gross of the month each sale closed. Months you
            don't change use {DEFAULT_AVG_GROSS.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {months.map(ym => (
            <div key={ym} className="flex items-center justify-between gap-3">
              <label htmlFor={`avg-gross-${ym}`} className="text-sm">
                {monthLabel(ym)}
                {values[ym] !== undefined && <span className="ml-2 text-xs text-muted-foreground">(custom)</span>}
              </label>
              <div className="relative w-36">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  id={`avg-gross-${ym}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={100}
                  className={`pl-6 text-right ${invalid.includes(ym) ? 'border-destructive' : ''}`}
                  value={draft[ym] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [ym]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
