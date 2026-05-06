import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Search, X } from 'lucide-react';

interface Org { id: string; name: string; slug?: string | null; status?: string | null }

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
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !userId) return;
    setSearch('');
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

  const filtered = orgs.filter(o => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      o.name.toLowerCase().includes(s) ||
      (o.slug ?? '').toLowerCase().includes(s)
    );
  });

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

        <div className="space-y-3 py-1">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{orgs.length} dealership{orgs.length !== 1 ? 's' : ''} total</span>
            <span>{selected.size} selected</span>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 pr-9"
              placeholder="Search by name or slug..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-md border p-2">
            {loading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {orgs.length === 0 ? 'No dealerships available.' : 'No organizations found.'}
              </p>
            ) : (
              filtered.map(o => {
                const isSelected = selected.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'bg-primary/10 ring-1 ring-primary/30'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(o.id)}
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{o.name}</p>
                      {o.slug && (
                        <p className="truncate text-xs text-muted-foreground font-mono">{o.slug}</p>
                      )}
                    </div>
                    {o.status && (
                      <Badge
                        variant={o.status === 'active' ? 'default' : 'secondary'}
                        className="shrink-0 text-xs"
                      >
                        {o.status}
                      </Badge>
                    )}
                  </button>
                );
              })
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
