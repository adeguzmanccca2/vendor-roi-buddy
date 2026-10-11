import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ListPlus } from 'lucide-react';
import { parseBulkRules, type BulkVendor } from '@/lib/sourceRulesBulk';

// Paste a Lead Provider / vendor list (e.g. straight from Excel) and add one
// exact-match rule per line. Parsing rules: src/lib/sourceRulesBulk.ts.
export function BulkSourceRulesDialog({
  organizationId,
  vendors,
  existingPatterns,
  onAdded,
}: {
  organizationId: string;
  vendors: BulkVendor[];
  existingPatterns: string[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const { lines, vendorFirst } = useMemo(
    () => parseBulkRules(text, vendors, existingPatterns),
    [text, vendors, existingPatterns],
  );
  const toAdd = lines.filter(l => l.kind === 'map' || l.kind === 'skip');
  const errors = lines.filter(l => l.kind === 'error');
  const vendorName = (id: string | null) => vendors.find(v => v.id === id)?.name ?? '';

  const add = async () => {
    if (toAdd.length === 0) return;
    setSaving(true);
    const { error } = await supabase.from('source_mapping_rules').insert(
      toAdd.map(l => ({
        organization_id: organizationId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vendor_id: l.vendorId as any, // null = skip rule (allowed since 20261009000000)
        pattern: l.provider,
        match_type: 'exact',
        priority: 100,
        notes: 'Bulk add',
      })),
    );
    setSaving(false);
    if (error) { toast.error('Adding rules failed: ' + error.message); return; }
    toast.success(`Added ${toAdd.length} rule(s)`);
    setText('');
    setOpen(false);
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><ListPlus className="mr-2 h-4 w-4" />Bulk add</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk add rules</DialogTitle>
          <DialogDescription>
            Paste two columns, one rule per line: Lead Provider and vendor name, in either order (tab- or
            comma-separated, e.g. copied from Excel). Leave the vendor blank or write "skip" for providers that
            shouldn't be imported, such as Service. Each line becomes an exact-match rule.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          className="font-mono text-xs"
          placeholder={'CarGurus\tCar Gurus\nDealer Website\tDealer\nService\tskip'}
        />
        {lines.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Read as {vendorFirst ? 'vendor, then Lead Provider' : 'Lead Provider, then vendor'}.
              {' '}{toAdd.length} to add
              {lines.some(l => l.kind === 'exists') && ` · ${lines.filter(l => l.kind === 'exists').length} already have a rule`}
              {errors.length > 0 && ` · ${errors.length} with problems`}
            </p>
            <div className="max-h-64 overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b bg-background text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left">Lead Provider</th>
                    <th className="px-2 py-1 text-left">Vendor</th>
                    <th className="px-2 py-1 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.line} className="border-b">
                      <td className="px-2 py-1">{l.provider || '—'}</td>
                      <td className="px-2 py-1">{l.kind === 'map' ? vendorName(l.vendorId) : l.kind === 'skip' ? 'Skip' : l.vendorText || '—'}</td>
                      <td className="px-2 py-1">
                        {l.kind === 'error'
                          ? <span className="text-destructive">{l.error}</span>
                          : l.kind === 'exists'
                            ? <Badge variant="outline">Already has a rule</Badge>
                            : <Badge variant="secondary">Add</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={add} disabled={saving || toAdd.length === 0}>
            {saving ? 'Adding…' : `Add ${toAdd.length} rule(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
