import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ShieldPlus, ShieldOff, UserPlus, Building2, Copy, X, Mail } from 'lucide-react';
import InviteUserDialog from '@/components/InviteUserDialog';
import UserOrgsDialog from '@/components/UserOrgsDialog';

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  organization_id: string | null;
}
interface Org { id: string; name: string; slug: string | null; status: string | null }
interface RoleRow { user_id: string; role: 'admin' | 'client' }
interface MembershipRow { user_id: string; organization_id: string }
interface InvitationRow {
  id: string;
  email: string;
  role: 'admin' | 'client';
  status: string;
  organization_ids: string[];
  token: string;
  expires_at: string;
  created_at: string;
}

export default function AdminUsers() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [orgsDialog, setOrgsDialog] = useState<{ id: string; label: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: o }, { data: r }, { data: m }, { data: i }] = await Promise.all([
      supabase.from('profiles').select('*').not('user_id', 'is', null).order('created_at', { ascending: false }),
      supabase.from('organizations').select('id, name, slug, status').eq('status', 'active').order('name'),
      supabase.from('user_roles').select('user_id, role'),
      supabase.from('user_organizations').select('user_id, organization_id'),
      supabase.from('invitations').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    setProfiles((p ?? []) as ProfileRow[]);
    setOrgs((o ?? []) as Org[]);
    setRoles((r ?? []) as RoleRow[]);
    setMemberships((m ?? []) as MembershipRow[]);
    setInvitations((i ?? []) as InvitationRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const userRoles = (uid: string) => roles.filter(r => r.user_id === uid).map(r => r.role);
  const userOrgs = (uid: string) =>
    memberships
      .filter(mem => mem.user_id === uid)
      .map(mem => orgs.find(o => o.id === mem.organization_id)?.name)
      .filter(Boolean) as string[];

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

  const copyInviteLink = async (token: string) => {
    const url = `${window.location.origin}/accept-invite?token=${token}`;
    await navigator.clipboard.writeText(url);
    toast.success('Invite link copied');
  };

  const revokeInvitation = async (id: string) => {
    const { error } = await supabase.from('invitations').update({ status: 'revoked' }).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Invitation revoked');
    load();
  };

  const pendingInvites = invitations.filter(i => i.status === 'pending');
  const pendingEmails = new Set(pendingInvites.map(i => i.email.toLowerCase()));
  const acceptedProfiles = profiles.filter(p =>
    p.user_id != null &&
    (p.email == null || !pendingEmails.has(p.email.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground">Invite users, assign dealerships, and manage admin access</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" /> Invite user
        </Button>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">All Users</TabsTrigger>
          <TabsTrigger value="invitations" className="gap-2">
            Pending Invitations
            {pendingInvites.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {pendingInvites.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1 — All Users */}
        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader><CardTitle>All Users ({acceptedProfiles.length})</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : acceptedProfiles.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No users yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Roles</TableHead>
                        <TableHead>Dealerships</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {acceptedProfiles.map(p => {
                        const r = userRoles(p.user_id);
                        const isAdminUser = r.includes('admin');
                        const orgNames = userOrgs(p.user_id);
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium">{p.full_name ?? '—'}</TableCell>
                            <TableCell className="text-sm">{p.email}</TableCell>
                            <TableCell className="space-x-1">
                              {r.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
                              {r.map(role => (
                                <Badge key={role} variant={role === 'admin' ? 'default' : 'secondary'}>{role}</Badge>
                              ))}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1">
                                {orgNames.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">— Unassigned —</span>
                                ) : (
                                  orgNames.map(n => (
                                    <Badge key={n} variant="outline" className="text-xs">{n}</Badge>
                                  ))
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setOrgsDialog({ id: p.user_id, label: p.full_name ?? p.email ?? p.user_id })}
                              >
                                <Building2 className="mr-1 h-4 w-4" /> Dealerships
                              </Button>
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
        </TabsContent>

        {/* Tab 2 — Pending Invitations */}
        <TabsContent value="invitations" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Pending Invitations ({pendingInvites.length})</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : pendingInvites.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No pending invitations.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Assigned Organization</TableHead>
                        <TableHead>Expires At</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingInvites.map(inv => {
                        const names = inv.organization_ids
                          .map(oid => orgs.find(o => o.id === oid)?.name)
                          .filter(Boolean) as string[];
                        const isExpired = new Date(inv.expires_at) < new Date();
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium">
                              <span className="inline-flex items-center gap-2">
                                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                {inv.email}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={inv.role === 'admin' ? 'default' : 'secondary'}>{inv.role}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {names.length > 0 ? names.join(', ') : '—'}
                            </TableCell>
                            <TableCell className={`text-sm ${isExpired ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                              {new Date(inv.expires_at).toLocaleDateString()}
                              {isExpired && <span className="ml-1 text-xs">(expired)</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" onClick={() => copyInviteLink(inv.token)}>
                                <Copy className="mr-1 h-3.5 w-3.5" /> Copy link
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => revokeInvitation(inv.id)}>
                                <X className="mr-1 h-3.5 w-3.5" /> Revoke
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
        </TabsContent>
      </Tabs>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} orgs={orgs} onSent={load} />
      <UserOrgsDialog
        open={orgsDialog !== null}
        onOpenChange={v => !v && setOrgsDialog(null)}
        userId={orgsDialog?.id ?? null}
        userLabel={orgsDialog?.label ?? ''}
        orgs={orgs}
        onSaved={load}
      />
    </div>
  );
}
