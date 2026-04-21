import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ShieldPlus, ShieldOff } from 'lucide-react';

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  organization_id: string | null;
}
interface Org { id: string; name: string }
interface RoleRow { user_id: string; role: 'admin' | 'client' }

export default function AdminUsers() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: o }, { data: r }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('organizations').select('id, name').order('name'),
      supabase.from('user_roles').select('user_id, role'),
    ]);
    setProfiles((p ?? []) as ProfileRow[]);
    setOrgs((o ?? []) as Org[]);
    setRoles((r ?? []) as RoleRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const userRoles = (uid: string) => roles.filter(r => r.user_id === uid).map(r => r.role);

  const assignOrg = async (userId: string, orgId: string | null) => {
    const { error } = await supabase
      .from('profiles')
      .update({ organization_id: orgId })
      .eq('user_id', userId);
    if (error) return toast.error(error.message);
    toast.success(orgId ? 'Dealership assigned' : 'Dealership cleared');
    load();
  };

  const toggleAdmin = async (userId: string, makeAdmin: boolean) => {
    if (makeAdmin) {
      const { error } = await supabase.from('user_roles').insert({ user_id: userId, role: 'admin' });
      if (error && !error.message.includes('duplicate')) return toast.error(error.message);
      toast.success('Admin role granted');
    } else {
      const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'admin');
      if (error) return toast.error(error.message);
      toast.success('Admin role removed');
    }
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground">Assign dealerships and manage admin access</p>
      </div>

      <Card>
        <CardHeader><CardTitle>All Users ({profiles.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : profiles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Dealership</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map(p => {
                    const r = userRoles(p.user_id);
                    const isAdminUser = r.includes('admin');
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.full_name ?? '—'}</TableCell>
                        <TableCell className="text-sm">{p.email}</TableCell>
                        <TableCell className="space-x-1">
                          {r.map(role => (
                            <Badge key={role} variant={role === 'admin' ? 'default' : 'secondary'}>{role}</Badge>
                          ))}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={p.organization_id ?? 'none'}
                            onValueChange={v => assignOrg(p.user_id, v === 'none' ? null : v)}
                          >
                            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Unassigned —</SelectItem>
                              {orgs.map(o => (
                                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          {isAdminUser ? (
                            <Button variant="ghost" size="sm" onClick={() => toggleAdmin(p.user_id, false)}>
                              <ShieldOff className="mr-1 h-4 w-4" /> Revoke admin
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => toggleAdmin(p.user_id, true)}>
                              <ShieldPlus className="mr-1 h-4 w-4" /> Make admin
                            </Button>
                          )}
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
    </div>
  );
}
