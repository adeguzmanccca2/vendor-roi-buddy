import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Org { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string | null;
  userLabel: string;
  orgs: Org[];
  onSaved?: () => void;
}

export default function UserOrgsDialog({ open, onOpenChange, userId, userLabel, orgs, onSaved }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('user_organizations')
        .select('organization_id')
        .eq('user_id', userId);
      setSelected(new Set((data ?? []).map(r => r.organization_id)));
      setLoading(false);
    })();
  }, [open, userId]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!userId) return;
    setBusy(true);

    const { data: existing } = await supabase
      .from('user_organizations')
      .select('organization_id')
      .eq('user_id', userId);
    const existingSet = new Set((existing ?? []).map(r => r.organization_id));

    const toAdd = [...selected].filter(id => !existingSet.has(id));
    const toRemove = [...existingSet].filter(id => !selected.has(id));

    if (toAdd.length > 0) {
      const { error } = await supabase.from('user_organizations').insert(
        toAdd.map(organization_id => ({ user_id: userId, organization_id, role: 'client' as const })),
      );
      if (error) {
        setBusy(false);
        return toast.error(error.message);
      }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from('user_organizations')
        .delete()
        .eq('user_id', userId)
        .in('organization_id', toRemove);
      if (error) {
        setBusy(false);
        return toast.error(error.message);
      }
    }

    // Keep profiles.organization_id in sync with first selected org for backwards compat
    const first = [...selected][0] ?? null;
    await supabase.from('profiles').update({ organization_id: first }).eq('user_id', userId);

    setBusy(false);
    toast.success('Dealership memberships updated');
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage dealerships</DialogTitle>
          <p className="text-sm text-muted-foreground">{userLabel}</p>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label>Dealerships ({selected.size} selected)</Label>
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : orgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No dealerships available.</p>
            ) : (
              orgs.map(o => (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                  <span>{o.name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || loading}>
            {busy ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
