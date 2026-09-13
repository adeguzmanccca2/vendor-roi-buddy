import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

// Client-facing counterpart to admin's /admin/portal/dms-logs. That page is
// deliberately left alone (admin-only, cross-dealership view via
// PortalLayout) -- this one is scoped to the currently selected org instead
// of relying solely on RLS, so switching dealerships in the org picker
// switches which logs are shown, and it renders in the normal AppLayout
// rather than the admin portal chrome.
interface DmsImportLog {
  id: string;
  filename: string | null;
  sender_email: string;
  rows_imported: number;
  duplicates_skipped: number;
  error_count: number;
  raw_errors: string[];
  received_at: string;
  status: 'success' | 'partial' | 'failed';
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'success') return 'default';
  if (status === 'partial') return 'secondary';
  return 'destructive';
}

// Same "lead" filename convention used server-side in api/inbound-email/dms.ts
// to decide which table a file targets.
function fileTypeLabel(filename: string | null): string {
  if (!filename) return '—';
  return /lead/i.test(filename) ? 'Leads' : 'Sales';
}

export default function ImportLogsPage() {
  const { activeOrgId, activeOrg } = useActiveOrg();
  const [logs, setLogs] = useState<DmsImportLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorsOpen, setErrorsOpen] = useState<DmsImportLog | null>(null);

  useEffect(() => {
    if (!activeOrgId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    // WHY the `as any` cast on the table name: dms_import_logs was added by
    // migration 20260826000000_inbound_email_import.sql, and types.ts
    // (auto-generated from the DB schema) hasn't been regenerated since —
    // CLAUDE.md says never hand-edit that file. Matches the same cast
    // already used in the admin version of this page.
    const { data, error } = await (supabase.from as any)('dms_import_logs')
      .select('id, filename, sender_email, rows_imported, duplicates_skipped, error_count, raw_errors, received_at, status')
      .eq('organization_id', activeOrgId)
      .order('received_at', { ascending: false })
      .limit(100);
    if (error) toast.error('Failed to load import logs: ' + error.message);
    setLogs((data ?? []) as DmsImportLog[]);
    setLoading(false);
  };

  if (!activeOrgId) return <p className="text-sm text-muted-foreground">Select a dealership first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2">
          <Link to="/sales"><ArrowLeft className="mr-1 h-4 w-4" /> Back to Sales</Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Import Logs</h1>
        <p className="text-sm text-muted-foreground">
          {activeOrg?.name} — every inbound-email DMS import attempt for this dealership (leads and sales), success, partial, or failed.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : logs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No import attempts yet for this dealership.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Duplicates</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(l.received_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>{fileTypeLabel(l.filename)}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm">{l.filename ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.sender_email}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(l.status)}>{l.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{l.rows_imported}</TableCell>
                    <TableCell className="text-right">{l.duplicates_skipped}</TableCell>
                    <TableCell className="text-right">
                      {l.error_count > 0 ? (
                        <Button variant="ghost" size="sm" onClick={() => setErrorsOpen(l)}>
                          <AlertCircle className="mr-1 h-4 w-4 text-destructive" />
                          {l.error_count}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!errorsOpen} onOpenChange={open => !open && setErrorsOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import errors</DialogTitle>
            <DialogDescription>{errorsOpen?.filename ?? '(no file)'}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {(errorsOpen?.raw_errors ?? []).map((err, i) => (
              <li key={i} className="rounded-md bg-muted p-2 font-mono text-xs">{err}</li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
