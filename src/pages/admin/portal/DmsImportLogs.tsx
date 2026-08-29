import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import PortalLayout from './PortalLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Search, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface DmsImportLog {
  id: string;
  organization_id: string | null;
  filename: string | null;
  sender_email: string;
  rows_imported: number;
  duplicates_skipped: number;
  error_count: number;
  raw_errors: string[];
  received_at: string;
  processed_at: string | null;
  status: 'success' | 'partial' | 'failed';
  organizations: { name: string } | null;
}

// WHY the `as any` cast on the table name: dms_import_logs was added by
// migration 20260826000000_inbound_email_import.sql, and src/integrations/
// supabase/types.ts (auto-generated from the DB schema) hasn't been
// regenerated since — CLAUDE.md says never hand-edit that file. Remove this
// cast once types.ts is regenerated from Supabase.
async function fetchLogs() {
  return (supabase.from as any)('dms_import_logs')
    .select('id, organization_id, filename, sender_email, rows_imported, duplicates_skipped, error_count, raw_errors, received_at, processed_at, status, organizations(name)')
    .order('received_at', { ascending: false })
    .limit(200);
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'success') return 'default';
  if (status === 'partial') return 'secondary';
  return 'destructive';
}

// Same "lead" filename convention used server-side in
// api/inbound-email/dms.ts to decide which table a file targets.
function fileTypeLabel(filename: string | null): string {
  if (!filename) return '—';
  return /lead/i.test(filename) ? 'Leads' : 'Sales';
}

export default function DmsImportLogs() {
  const [logs, setLogs] = useState<DmsImportLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [errorsOpen, setErrorsOpen] = useState<DmsImportLog | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await fetchLogs();
    if (error) toast.error(error.message);
    setLogs((data ?? []) as DmsImportLog[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = logs.filter(l => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (l.organizations?.name ?? '').toLowerCase().includes(s) ||
      (l.filename ?? '').toLowerCase().includes(s) ||
      l.sender_email.toLowerCase().includes(s)
    );
  });

  return (
    <PortalLayout>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Every inbound-email DMS import attempt (CDK/Fortellis sync and the receive-sales/leads email path) — success, partial, or failed.
          </p>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by dealership, filename, or sender..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {logs.length === 0 ? 'No import attempts yet.' : 'No matches.'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>Dealership</TableHead>
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
                  {filtered.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(l.received_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="font-medium">{l.organizations?.name ?? '—'}</TableCell>
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
      </div>

      <Dialog open={!!errorsOpen} onOpenChange={open => !open && setErrorsOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import errors</DialogTitle>
            <DialogDescription>
              {errorsOpen?.organizations?.name ?? 'Unknown dealership'} — {errorsOpen?.filename ?? '(no file)'}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {(errorsOpen?.raw_errors ?? []).map((err, i) => (
              <li key={i} className="rounded-md bg-muted p-2 font-mono text-xs">{err}</li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
