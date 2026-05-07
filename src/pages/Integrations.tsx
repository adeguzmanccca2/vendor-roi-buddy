import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy, Eye, EyeOff, Plus, Trash2, ToggleLeft, ToggleRight, Plug } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Credential {
  id: string;
  organization_id: string;
  label: string;
  provider: string;
  api_key: string;
  is_active: boolean;
  last_used_at: string | null;
  lead_count: number;
  sale_count: number;
  created_at: string;
}

const PROVIDERS = [
  { value: 'generic',      label: 'Generic' },
  { value: 'dealersocket', label: 'DealerSocket' },
  { value: 'vinsolutions', label: 'VinSolutions' },
  { value: 'elead',        label: 'eLead' },
  { value: 'dealerpeak',   label: 'DealerPeak' },
  { value: 'cars_com',     label: 'Cars.com' },
  { value: 'autotrader',   label: 'AutoTrader' },
  { value: 'cargurus',     label: 'CarGurus' },
  { value: 'other',        label: 'Other' },
];

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/receive-leads`;

function maskKey(key: string) {
  return `${key.slice(0, 8)}${'•'.repeat(20)}${key.slice(-4)}`;
}

function buildCurl(key: string) {
  return `curl -X POST ${ENDPOINT} \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${key}" \\
  -d '{
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "phone": "5551234567",
    "vin": "1HGBH41JXMN109186",
    "stock_number": "S12345",
    "vehicle_year": 2024,
    "vehicle_make": "Honda",
    "vehicle_model": "Accord",
    "source": "AutoTrader"
  }'`;
}

export default function Integrations() {
  const { isAdmin } = useAuth();
  const { activeOrgId, orgs } = useActiveOrg();

  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newProvider, setNewProvider] = useState('generic');
  const [newOrgId, setNewOrgId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    let q = supabase.from('api_credentials').select('*').order('created_at', { ascending: false });
    if (!isAdmin && activeOrgId) q = q.eq('organization_id', activeOrgId);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setCredentials((data ?? []) as Credential[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVisible = (id: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const copyText = async (text: string, label = 'Copied') => {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  };

  const toggleActive = async (cred: Credential) => {
    const { error } = await supabase
      .from('api_credentials')
      .update({ is_active: !cred.is_active })
      .eq('id', cred.id);
    if (error) return toast.error(error.message);
    toast.success(cred.is_active ? 'Key deactivated' : 'Key activated');
    load();
  };

  const deleteCred = async (id: string) => {
    const { error } = await supabase.from('api_credentials').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Integration removed');
    load();
  };

  const openDialog = () => {
    setNewLabel('');
    setNewProvider('generic');
    setNewOrgId(isAdmin ? (orgs[0]?.id ?? '') : (activeOrgId ?? ''));
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!newLabel.trim()) return toast.error('Label is required');
    const orgId = isAdmin ? newOrgId : activeOrgId;
    if (!orgId) return toast.error('Select a dealership');
    setBusy(true);
    const { error } = await supabase
      .from('api_credentials')
      .insert({ label: newLabel.trim(), provider: newProvider, organization_id: orgId });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Integration created');
    setDialogOpen(false);
    load();
  };

  const exampleKey = credentials[0]?.api_key ?? 'YOUR_API_KEY';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
          <p className="text-sm text-muted-foreground">Connect your CRM to automatically push leads via API</p>
        </div>
        <Button onClick={openDialog}>
          <Plus className="mr-2 h-4 w-4" /> New integration
        </Button>
      </div>

      {/* Endpoint */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" /> Webhook Endpoint
          </CardTitle>
          <CardDescription>POST leads to this URL from your CRM using one of your API keys below.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input value={ENDPOINT} readOnly className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => copyText(ENDPOINT, 'Endpoint copied')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* API keys table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Keys ({credentials.length})</CardTitle>
          <CardDescription>Each key is scoped to one dealership. Deactivate a key to immediately block its access.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : credentials.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No integrations yet — click <strong>New integration</strong> to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Provider</TableHead>
                    {isAdmin && <TableHead>Dealership</TableHead>}
                    <TableHead>API Key</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials.map(cred => {
                    const shown = visibleKeys.has(cred.id);
                    const providerLabel = PROVIDERS.find(p => p.value === cred.provider)?.label ?? cred.provider;
                    const orgName = orgs.find(o => o.id === cred.organization_id)?.name ?? '—';
                    return (
                      <TableRow key={cred.id}>
                        <TableCell className="font-medium">{cred.label}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{providerLabel}</TableCell>
                        {isAdmin && <TableCell className="text-sm">{orgName}</TableCell>}
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                              {shown ? cred.api_key : maskKey(cred.api_key)}
                            </code>
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6"
                              onClick={() => toggleVisible(cred.id)}
                            >
                              {shown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6"
                              onClick={() => copyText(cred.api_key, 'API key copied')}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={cred.is_active ? 'default' : 'secondary'}>
                            {cred.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {cred.last_used_at
                            ? formatDistanceToNow(new Date(cred.last_used_at), { addSuffix: true })
                            : 'Never'}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {cred.lead_count.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {cred.sale_count.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => toggleActive(cred)}>
                            {cred.is_active
                              ? <><ToggleRight className="mr-1 h-4 w-4" /> Deactivate</>
                              : <><ToggleLeft className="mr-1 h-4 w-4" /> Activate</>}
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteCred(cred.id)}
                          >
                            <Trash2 className="mr-1 h-4 w-4" /> Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Example request */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Example Request</CardTitle>
          <CardDescription>Fields support both snake_case and camelCase. Send a single object, an array, or <code className="bg-muted px-1 text-xs">{"{ \"leads\": [...] }"}</code>.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed whitespace-pre">
              {buildCurl(exampleKey)}
            </pre>
            <Button
              variant="outline" size="sm"
              className="absolute right-2 top-2"
              onClick={() => copyText(buildCurl(exampleKey), 'Copied to clipboard')}
            >
              <Copy className="mr-1 h-3 w-3" /> Copy
            </Button>
          </div>
          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
            <li><span className="font-medium text-foreground">Auth:</span> pass via <code className="rounded bg-muted px-1">x-api-key</code> header or <code className="rounded bg-muted px-1">Authorization: Bearer &lt;key&gt;</code></li>
            <li><span className="font-medium text-foreground">Batch:</span> up to 500 leads per request</li>
            <li><span className="font-medium text-foreground">Response:</span> <code className="rounded bg-muted px-1">{"{ success, inserted, ids }"}</code></li>
          </ul>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New integration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                placeholder="e.g. DealerSocket production"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>CRM Provider</Label>
              <Select value={newProvider} onValueChange={setNewProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <div className="space-y-2">
                <Label>Dealership</Label>
                <Select value={newOrgId} onValueChange={setNewOrgId}>
                  <SelectTrigger><SelectValue placeholder="Select dealership..." /></SelectTrigger>
                  <SelectContent>
                    {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy}>{busy ? 'Creating...' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
