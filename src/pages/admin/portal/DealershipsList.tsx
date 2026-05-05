import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import PortalLayout from './PortalLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Search, Pencil, Eye } from 'lucide-react';
import { toast } from 'sonner';

interface Dealership {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

export default function DealershipsList() {
  const navigate = useNavigate();
  const [list, setList] = useState<Dealership[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}? This will unassign all its users and remove its data.`)) return;
    const { error } = await supabase.from('organizations').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Dealership deleted');
    load();
  };

  const toggleStatus = async (d: Dealership) => {
    const next = d.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('organizations').update({ status: next }).eq('id', d.id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${next}`);
    load();
  };

  const filtered = list.filter(d => {
    if (!search) return true;
    const s = search.toLowerCase();
    return d.name.toLowerCase().includes(s) || d.slug.toLowerCase().includes(s);
  });

  return (
    <PortalLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name or slug..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button asChild>
            <Link to="/admin/portal/dealerships/new">
              <Plus className="mr-2 h-4 w-4" />Add Dealership
            </Link>
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {list.length === 0 ? 'No dealerships yet.' : 'No matches.'}
              </p>
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
                  {filtered.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="font-mono text-xs">{d.slug}</TableCell>
                      <TableCell>
                        <button onClick={() => toggleStatus(d)}>
                          <Badge variant={d.status === 'active' ? 'default' : 'secondary'}>
                            {d.status}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(d.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/portal/dealerships/${d.id}`)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/portal/dealerships/${d.id}/edit`)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
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
    </PortalLayout>
  );
}
