import { useEffect, useState } from 'react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Dealership {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

const nameSchema = z.string().trim().min(2).max(100);
const slugSchema = z.string().trim().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only');

export default function AdminDealerships() {
  const [list, setList] = useState<Dealership[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setList((data ?? []) as Dealership[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = nameSchema.safeParse(name);
    const s = slugSchema.safeParse(slug);
    if (!n.success) return toast.error('Invalid name (2–100 chars)');
    if (!s.success) return toast.error(s.error.errors[0].message);

    setBusy(true);
    const { error } = await supabase.from('organizations').insert({ name: n.data, slug: s.data });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes('duplicate') ? 'Slug already exists' : error.message);
      return;
    }
    toast.success('Dealership created');
    setName('');
    setSlug('');
    setOpen(false);
    load();
  };

  const handleDelete = async (id: string, dealershipName: string) => {
    if (!confirm(`Delete ${dealershipName}? This will unassign all its users.`)) return;
    const { error } = await supabase.from('organizations').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Dealership deleted');
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dealerships</h1>
          <p className="text-sm text-muted-foreground">Manage dealership accounts</p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> New Dealership</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Dealership</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="d-name">Name</Label>
                <Input id="d-name" value={name} onChange={e => setName(e.target.value)} placeholder="Smith Ford of Dallas" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-slug">Slug</Label>
                <Input id="d-slug" value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} placeholder="smith-ford-dallas" />
                <p className="text-xs text-muted-foreground">Lowercase letters, numbers, hyphens.</p>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Creating...' : 'Create'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>All Dealerships ({list.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No dealerships yet. Create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map(d => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="font-mono text-xs">{d.slug}</TableCell>
                    <TableCell><Badge variant={d.status === 'active' ? 'default' : 'secondary'}>{d.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(d.id, d.name)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
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
