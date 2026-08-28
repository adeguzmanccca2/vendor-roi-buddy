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
import { Copy, Eye, EyeOff, Plus, Trash2, ToggleLeft, ToggleRight, Plug, RefreshCw } from 'lucide-react';
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
const SALES_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/receive-sales`;

interface CdkPreviewItem {
  cdk_opportunity_id: string;
  lead_date: string | null;
  source_label: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  isDuplicate: boolean;
}

interface CdkCredential {
  id: string;
  organization_id: string;
  client_id: string;
  client_secret: string;
  subscription_id: string;
  token_url: string | null;
  department_id: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
}

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

function buildSalesCurl(key: string) {
  return `curl -X POST ${SALES_ENDPOINT} \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${key}" \\
  -d '{
    "full_name": "Jane Smith",
    "email": "jane@example.com",
    "phone": "5551234567",
    "vin": "1HGBH41JXMN109186",
    "stock_number": "S12345",
    "sale_date": "2026-08-24",
    "sale_price": 28500,
    "vehicle_year": 2024,
    "vehicle_make": "Honda",
    "vehicle_model": "Accord",
    "salesperson": "Mike R."
  }'`;
}

function buildSalesPowerShell(key: string) {
  return `# Save as push-sales.ps1, then schedule it in Task Scheduler to run 2x/day.
# Point $file at wherever your DMS/CRM exports the sales CSV/JSON to.
$file = "C:\\Exports\\sales-export.json"
$body = Get-Content $file -Raw
Invoke-RestMethod -Method Post -Uri "${SALES_ENDPOINT}" \`
  -Headers @{ "x-api-key" = "${key}" } \`
  -ContentType "application/json" \`
  -Body $body`;
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

  const [cdkCred, setCdkCred] = useState<CdkCredential | null>(null);
  const [cdkLoading, setCdkLoading] = useState(true);
  const [cdkClientId, setCdkClientId] = useState('');
  const [cdkClientSecret, setCdkClientSecret] = useState('');
  const [cdkSubscriptionId, setCdkSubscriptionId] = useState('');
  const [cdkTokenUrl, setCdkTokenUrl] = useState('');
  const [cdkDepartmentId, setCdkDepartmentId] = useState('');
  const [cdkShowSecret, setCdkShowSecret] = useState(false);
  const [cdkSaving, setCdkSaving] = useState(false);
  const [cdkSyncing, setCdkSyncing] = useState(false);
  const [cdkTesting, setCdkTesting] = useState(false);
  const [cdkPullDialogOpen, setCdkPullDialogOpen] = useState(false);
  const [cdkDateFrom, setCdkDateFrom] = useState('');
  const [cdkDateTo, setCdkDateTo] = useState('');
  const [cdkPreviewing, setCdkPreviewing] = useState(false);
  const [cdkPreview, setCdkPreview] = useState<{
    items: CdkPreviewItem[];
    totalFetched: number;
    newCount: number;
    alreadyImportedCount: number;
    enriched: number;
    truncated: boolean;
  } | null>(null);

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

  const loadCdkCred = async () => {
    if (!activeOrgId) { setCdkLoading(false); return; }
    setCdkLoading(true);
    const { data, error } = await supabase
      .from('cdk_fortellis_credentials')
      .select('*')
      .eq('organization_id', activeOrgId)
      .maybeSingle();
    if (error) toast.error(error.message);
    const cred = (data ?? null) as CdkCredential | null;
    setCdkCred(cred);
    setCdkClientId(cred?.client_id ?? '');
    setCdkClientSecret(cred?.client_secret ?? '');
    setCdkSubscriptionId(cred?.subscription_id ?? '');
    setCdkTokenUrl(cred?.token_url ?? '');
    setCdkDepartmentId(cred?.department_id ?? '');
    setCdkLoading(false);
  };

  useEffect(() => { loadCdkCred(); }, [activeOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveCdkCred = async () => {
    if (!activeOrgId) return toast.error('Select a dealership');
    if (!cdkClientId.trim() || !cdkClientSecret.trim() || !cdkSubscriptionId.trim()) {
      return toast.error('Client ID, Client Secret, and Subscription ID are required');
    }
    setCdkSaving(true);
    const { error } = await supabase
      .from('cdk_fortellis_credentials')
      .upsert({
        organization_id: activeOrgId,
        client_id: cdkClientId.trim(),
        client_secret: cdkClientSecret.trim(),
        subscription_id: cdkSubscriptionId.trim(),
        token_url: cdkTokenUrl.trim() || null,
        department_id: cdkDepartmentId.trim() || null,
      }, { onConflict: 'organization_id' });
    setCdkSaving(false);
    if (error) return toast.error(error.message);
    toast.success('CDK/Fortellis connection saved');
    loadCdkCred();
  };

  const testCdkConnection = async () => {
    if (!activeOrgId) return toast.error('Select a dealership');
    setCdkTesting(true);
    const { data, error } = await supabase.functions.invoke('cdk-fortellis-sync', {
      body: { organizationId: activeOrgId, test: true },
    });
    setCdkTesting(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);

    if (!data.opportunitiesOk) {
      toast.error(`Opportunities API failed: ${data.opportunitiesMessage}`);
    } else if (data.departmentOk === false) {
      toast.warning(`Opportunities OK, but Drive customer lookup failed: ${data.departmentMessage}`);
    } else {
      toast.success(`Connection OK — ${data.opportunitiesMessage}${data.departmentOk ? '; ' + data.departmentMessage : ''}`);
    }
    loadCdkCred();
  };

  const openCdkPullDialog = () => {
    const today = new Date();
    const firstOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    setCdkDateFrom(firstOfPrevMonth.toISOString().slice(0, 10));
    setCdkDateTo(today.toISOString().slice(0, 10));
    setCdkPreview(null);
    setCdkPullDialogOpen(true);
  };

  const previewCdkPull = async () => {
    if (!activeOrgId) return toast.error('Select a dealership');
    if (!cdkDateFrom || !cdkDateTo) return toast.error('Pick a date range');
    setCdkPreviewing(true);
    setCdkPreview(null);
    const { data, error } = await supabase.functions.invoke('cdk-fortellis-sync', {
      body: {
        organizationId: activeOrgId,
        preview: true,
        dateFrom: `${cdkDateFrom}T00:00:00Z`,
        dateTo: `${cdkDateTo}T23:59:59Z`,
      },
    });
    setCdkPreviewing(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);
    setCdkPreview(data);
  };

  const confirmCdkImport = async () => {
    if (!activeOrgId) return toast.error('Select a dealership');
    if (!cdkDateFrom || !cdkDateTo) return toast.error('Pick a date range');
    setCdkSyncing(true);
    const { data, error } = await supabase.functions.invoke('cdk-fortellis-sync', {
      body: {
        organizationId: activeOrgId,
        dateFrom: `${cdkDateFrom}T00:00:00Z`,
        dateTo: `${cdkDateTo}T23:59:59Z`,
      },
    });
    setCdkSyncing(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);
    setCdkPullDialogOpen(false);
    setCdkPreview(null);
    toast.success(`Imported ${data.inserted} new leads (${data.fetched} fetched, ${data.skipped} already imported, ${data.enriched} enriched with contact info)`);
    loadCdkCred();
  };

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

      {/* Sales webhook endpoint */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" /> Sales Webhook Endpoint
          </CardTitle>
          <CardDescription>
            POST sales to this URL — same API key as above. Good for a scheduled script
            (e.g. a Windows Task Scheduler job run 2x/day) that pushes a DMS export
            without your IT team needing FTP access or to build against a full API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input value={SALES_ENDPOINT} readOnly className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => copyText(SALES_ENDPOINT, 'Endpoint copied')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CDK / Fortellis connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" /> CDK / Elead (Fortellis)
          </CardTitle>
          <CardDescription>
            Pull sales opportunities directly from CDK's Elead CRM via the Fortellis platform for a
            chosen date range (e.g. once a month), enriched with customer contact info from CDK
            Drive. Requires a Fortellis app connected to the CRM Sales Opportunities API and the
            CDK Drive Post Customer API — see the app's Authorization tab for the client id,
            secret, and OAuth token URL, and the Drive Department ID (must resolve to an
            Accounting department in the DMS).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!activeOrgId ? (
            <p className="text-sm text-muted-foreground">Select a dealership to configure this connection.</p>
          ) : cdkLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input value={cdkClientId} onChange={e => setCdkClientId(e.target.value)} placeholder="Fortellis API key" />
                </div>
                <div className="space-y-2">
                  <Label>Client Secret</Label>
                  <div className="flex items-center gap-1">
                    <Input
                      type={cdkShowSecret ? 'text' : 'password'}
                      value={cdkClientSecret}
                      onChange={e => setCdkClientSecret(e.target.value)}
                      placeholder="Fortellis API secret"
                    />
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setCdkShowSecret(v => !v)}>
                      {cdkShowSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Subscription ID</Label>
                  <Input value={cdkSubscriptionId} onChange={e => setCdkSubscriptionId(e.target.value)} placeholder="Fortellis Subscription-Id" />
                </div>
                <div className="space-y-2">
                  <Label>Token URL</Label>
                  <Input
                    value={cdkTokenUrl}
                    onChange={e => setCdkTokenUrl(e.target.value)}
                    placeholder="https://identity.fortellis.io/oauth2/.../v1/token"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Drive Department ID</Label>
                  <Input
                    value={cdkDepartmentId}
                    onChange={e => setCdkDepartmentId(e.target.value)}
                    placeholder="Accounting department id (for customer enrichment)"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div className="text-xs text-muted-foreground">
                  {cdkCred?.last_synced_at
                    ? `Last synced ${formatDistanceToNow(new Date(cdkCred.last_synced_at), { addSuffix: true })}`
                    : 'Never synced'}
                  {cdkCred?.last_sync_status && (
                    <span className="ml-2 font-mono">({cdkCred.last_sync_status})</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={saveCdkCred} disabled={cdkSaving}>
                    {cdkSaving ? 'Saving...' : 'Save connection'}
                  </Button>
                  <Button variant="outline" onClick={testCdkConnection} disabled={cdkTesting || !cdkCred}>
                    <Plug className={`mr-2 h-4 w-4 ${cdkTesting ? 'animate-pulse' : ''}`} />
                    {cdkTesting ? 'Testing...' : 'Test connection'}
                  </Button>
                  <Button onClick={openCdkPullDialog} disabled={cdkSyncing || !cdkCred}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${cdkSyncing ? 'animate-spin' : ''}`} />
                    Pull from CRM
                  </Button>
                </div>
              </div>
            </>
          )}
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

      {/* Sales example request */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sales Example Request</CardTitle>
          <CardDescription>
            Send a single object, an array, or <code className="bg-muted px-1 text-xs">{"{ \"sales\": [...] }"}</code>.
            Re-sending the same record (e.g. two overlapping daily pushes) is safe — matching VIN/stock/contact +
            sale date rows are deduped automatically. Newly ingested sales are auto-attributed to leads/vendors
            by email then phone, same as CSV upload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed whitespace-pre">
              {buildSalesCurl(exampleKey)}
            </pre>
            <Button
              variant="outline" size="sm"
              className="absolute right-2 top-2"
              onClick={() => copyText(buildSalesCurl(exampleKey), 'Copied to clipboard')}
            >
              <Copy className="mr-1 h-3 w-3" /> Copy
            </Button>
          </div>
          <div className="relative mt-4">
            <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed whitespace-pre">
              {buildSalesPowerShell(exampleKey)}
            </pre>
            <Button
              variant="outline" size="sm"
              className="absolute right-2 top-2"
              onClick={() => copyText(buildSalesPowerShell(exampleKey), 'Copied to clipboard')}
            >
              <Copy className="mr-1 h-3 w-3" /> Copy
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The PowerShell script above is meant to hand directly to IT: they schedule it in Task Scheduler to
            run 2x/day and point <code className="rounded bg-muted px-1">$file</code> at wherever their export lands — no API
            knowledge or FTP server needed.
          </p>
          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
            <li><span className="font-medium text-foreground">Batch:</span> up to 1000 sales per request</li>
            <li><span className="font-medium text-foreground">Response:</span> <code className="rounded bg-muted px-1">{"{ success, received, inserted, duplicates, ids }"}</code></li>
          </ul>
        </CardContent>
      </Card>

      {/* CDK pull date range dialog */}
      <Dialog open={cdkPullDialogOpen} onOpenChange={setCdkPullDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pull opportunities from CDK</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Choose the date range, preview what will be imported, then confirm. Nothing is written
              to Leads until you confirm.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From</Label>
                <Input
                  type="date"
                  value={cdkDateFrom}
                  onChange={e => { setCdkDateFrom(e.target.value); setCdkPreview(null); }}
                />
              </div>
              <div className="space-y-2">
                <Label>To</Label>
                <Input
                  type="date"
                  value={cdkDateTo}
                  onChange={e => { setCdkDateTo(e.target.value); setCdkPreview(null); }}
                />
              </div>
            </div>

            {!cdkPreview ? (
              <Button variant="outline" onClick={previewCdkPull} disabled={cdkPreviewing} className="w-full">
                {cdkPreviewing ? 'Fetching preview...' : 'Preview'}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="font-medium text-foreground">{cdkPreview.totalFetched}</span> opportunities found —{' '}
                  <span className="font-medium text-foreground">{cdkPreview.newCount}</span> new,{' '}
                  <span className="text-muted-foreground">{cdkPreview.alreadyImportedCount} already imported</span>,{' '}
                  <span className="text-muted-foreground">{cdkPreview.enriched} enriched with contact info</span>
                </div>
                {cdkPreview.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No opportunities found in this date range.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>Vehicle</TableHead>
                          <TableHead className="text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cdkPreview.items.map(item => (
                          <TableRow key={item.cdk_opportunity_id}>
                            <TableCell className="whitespace-nowrap text-xs">
                              {item.lead_date ? new Date(item.lead_date).toLocaleDateString() : '—'}
                            </TableCell>
                            <TableCell className="text-xs">
                              <div>{item.customer_full_name ?? '—'}</div>
                              <div className="text-muted-foreground">{item.customer_email ?? item.customer_phone ?? ''}</div>
                            </TableCell>
                            <TableCell className="text-xs">{item.source_label ?? '—'}</TableCell>
                            <TableCell className="text-xs">
                              {[item.vehicle_year, item.vehicle_make, item.vehicle_model].filter(Boolean).join(' ') || '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={item.isDuplicate ? 'secondary' : 'default'}>
                                {item.isDuplicate ? 'Already imported' : 'New'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {cdkPreview.truncated && (
                  <p className="text-xs text-muted-foreground">Showing first 500 of {cdkPreview.totalFetched} — the full set will still be imported on confirm.</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCdkPullDialogOpen(false)} disabled={cdkSyncing}>Cancel</Button>
            <Button
              onClick={confirmCdkImport}
              disabled={cdkSyncing || !cdkPreview || cdkPreview.newCount === 0}
            >
              {cdkSyncing ? 'Importing...' : cdkPreview ? `Confirm import (${cdkPreview.newCount} new)` : 'Confirm import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
