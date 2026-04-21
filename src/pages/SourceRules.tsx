import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Trash2, Play, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface Vendor { id: string; name: string }
interface Rule {
  id: string;
  pattern: string;
  match_type: string;
  priority: number;
  is_active: boolean;
  vendor_id: string;
  vendor?: { name: string };
}
interface UnmappedSource { source_label: string; count: number }

export default function SourceRulesPage() {
  const { activeOrgId } = useActiveOrg();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  // form
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<'exact' | 'contains'>('contains');
  const [priority, setPriority] = useState(100);
  const [vendorId, setVendorId] = useState<string>('');

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    const [v, r, l] = await Promise.all([
      supabase.from('vendors').select('id, name').eq('organization_id', activeOrgId).order('name'),
      supabase
        .from('source_mapping_rules')
        .select('id, pattern, match_type, priority, is_active, vendor_id, vendors(name)')
        .eq('organization_id', activeOrgId)
        .order('priority'),
      supabase
        .from('leads')
        .select('source_label')
        .eq('organization_id', activeOrgId)
        .is('vendor_id', null)
        .not('source_label', 'is', null)
        .limit(1000),
    ]);
    setVendors((v.data ?? []) as Vendor[]);
    setRules(
      (r.data ?? []).map((row: any) => ({ ...row, vendor: row.vendors })) as Rule[],
    );
    // group unmapped sources
    const counts = new Map<string, number>();
    (l.data ?? []).forEach((row: any) => {
      const key = (row.source_label ?? '').trim();
      if (!key) return;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    setUnmapped(
      Array.from(counts.entries())
        .map(([source_label, count]) => ({ source_label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
    );
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrgId]);

  const addRule = async (presetPattern?: string) => {
    const pat = (presetPattern ?? pattern).trim();
    if (!activeOrgId || !pat || !vendorId) {
      toast.error('Pattern and vendor are required');
      return;
    }
    const { error } = await supabase.from('source_mapping_rules').insert({
      organization_id: activeOrgId,
      vendor_id: vendorId,
      pattern: pat,
      match_type: matchType,
      priority,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Rule added');
    setOpen(false);
    setPattern('');
    setVendorId('');
    setPriority(100);
    load();
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    const { error } = await supabase
      .from('source_mapping_rules')
      .update({ is_active })
      .eq('id', id);
    if (error) toast.error(error.message);
    else load();
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    const { error } = await supabase.from('source_mapping_rules').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Deleted'); load(); }
  };

  const runMapping = async () => {
    if (!activeOrgId) return;
    setRunning(true);
    const { data, error } = await supabase.rpc('apply_source_mapping_for_org', { _org_id: activeOrgId });
    setRunning(false);
    if (error) { toast.error(error.message); return; }
    const result = data?.[0];
    toast.success(`Mapped ${result?.updated_count ?? 0} of ${result?.total_unmapped ?? 0} unmapped leads`);
    load();
  };

  const openForSource = (src: string) => {
    setPattern(src);
    setMatchType('contains');
    setOpen(true);
  };

  if (!activeOrgId) {
    return <p className="text-sm text-muted-foreground">Select a dealership to manage source rules.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Source Mapping Rules</h1>
          <p className="text-sm text-muted-foreground">
            Map messy lead source strings to specific vendors.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={runMapping} disabled={running}>
            <Play className="mr-2 h-4 w-4" />
            {running ? 'Running...' : 'Apply Rules Now'}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button>Add Rule</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New source rule</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Pattern</Label>
                  <Input
                    value={pattern}
                    onChange={e => setPattern(e.target.value)}
                    placeholder="e.g. autotrader"
                  />
                </div>
                <div>
                  <Label>Match Type</Label>
                  <Select value={matchType} onValueChange={(v: any) => setMatchType(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">Contains (case-insensitive)</SelectItem>
                      <SelectItem value="exact">Exact match</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Vendor</Label>
                  <Select value={vendorId} onValueChange={setVendorId}>
                    <SelectTrigger><SelectValue placeholder="Pick vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority (lower wins)</Label>
                  <Input
                    type="number"
                    value={priority}
                    onChange={e => setPriority(parseInt(e.target.value) || 100)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => addRule()}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {unmapped.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              Needs mapping ({unmapped.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {unmapped.map(u => (
                <button
                  key={u.source_label}
                  onClick={() => openForSource(u.source_label)}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <span className="font-medium">{u.source_label}</span>
                  <Badge variant="secondary">{u.count}</Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Active Rules</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules yet. Add one to start auto-assigning vendors.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead>Pattern</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell className="font-mono text-xs">{r.pattern}</TableCell>
                    <TableCell><Badge variant="outline">{r.match_type}</Badge></TableCell>
                    <TableCell>{r.vendor?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Switch
                        checked={r.is_active}
                        onCheckedChange={v => toggleActive(r.id, v)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => deleteRule(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
