import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Invitation {
  id: string;
  email: string;
  role: 'admin' | 'client';
  organization_ids: string[];
  status: string;
  expires_at: string;
}

const passwordSchema = z.string().min(8).max(72);
const nameSchema = z.string().trim().min(1).max(100);

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const { user, refresh, signOut } = useAuth();

  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [orgNames, setOrgNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // signup fields (only used if no user)
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    (async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      const { data: rows, error } = await supabase
        .rpc('get_invitation_by_token', { _token: token });
      const data = rows?.[0] ?? null;
      if (error || !data) {
        setInvitation(null);
      } else {
        setInvitation(data as Invitation);
        if (data.organization_ids?.length) {
          const { data: orgs } = await supabase
            .from('organizations')
            .select('name')
            .in('id', data.organization_ids);
          setOrgNames((orgs ?? []).map(o => o.name));
        }
      }
      setLoading(false);
    })();
  }, [token]);

  const acceptAfterAuth = async () => {
    const { data, error } = await supabase.rpc('accept_invitation', { _token: token });
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = (data as Array<{ success: boolean; message: string }>)?.[0];
    if (!result?.success) {
      toast.error(result?.message ?? 'Could not accept invitation');
      return;
    }
    toast.success('Invitation accepted!');
    await refresh();
    navigate('/', { replace: true });
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;
    const nameRes = nameSchema.safeParse(fullName);
    const pwRes = passwordSchema.safeParse(password);
    if (!nameRes.success) return toast.error('Name required');
    if (!pwRes.success) return toast.error('Password must be at least 8 characters');

    setBusy(true);
    try {
      // Account creation happens server-side via the service-role key rather
      // than supabase.auth.signUp(). That endpoint is public self-registration,
      // which is now disabled -- see api/auth/accept-invite-signup.ts. The
      // email comes from the invitation row there, not from this form, so an
      // invite can only ever create the account it was issued for.
      const res = await fetch('/api/auth/accept-invite-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pwRes.data, fullName: nameRes.data }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(body?.error ?? 'Could not create your account. Please try again.');
        return;
      }

      // Sign in with the password just set. This is also the path taken when
      // the account already existed, in which case the typed password has to
      // be their existing one.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: invitation.email,
        password: pwRes.data,
      });

      if (signInErr) {
        toast.error(
          body?.alreadyExisted
            ? 'An account already exists for this email. Please sign in with your existing password.'
            : 'Account created, but sign-in failed. Please sign in to continue.',
        );
        navigate('/auth');
        return;
      }

      await acceptAfterAuth();
    } catch {
      toast.error('Could not reach the server. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  // The signed-in account must be the invited address, or accept_invitation will reject it.
  const emailMismatch =
    !!user && !!invitation &&
    (user.email ?? '').trim().toLowerCase() !== invitation.email.trim().toLowerCase();

  // If the right user is signed in already, auto-accept.
  useEffect(() => {
    if (user && invitation && invitation.status === 'pending' && !emailMismatch) {
      acceptAfterAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, invitation, emailMismatch]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading invitation...</p>
      </div>
    );
  }

  if (!token || !invitation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Invitation not found</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This invitation link is invalid or has been revoked.
            </p>
            <Button className="mt-4" onClick={() => navigate('/auth')}>Go to sign in</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const expired = new Date(invitation.expires_at) < new Date();
  if (invitation.status !== 'pending' || expired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Invitation {expired ? 'expired' : invitation.status}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {expired ? 'This invite link has expired. Please ask for a new one.' : 'This invitation is no longer pending.'}
            </p>
            <Button className="mt-4" onClick={() => navigate('/auth')}>Go to sign in</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (emailMismatch) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Wrong account signed in</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This invitation was sent to{' '}
              <span className="font-medium text-foreground">{invitation.email}</span>, but you're
              signed in as <span className="font-medium text-foreground">{user?.email}</span>.
            </p>
            <p className="text-sm text-muted-foreground">
              Sign out and come back to this link to accept it as {invitation.email}.
            </p>
            <Button
              className="w-full"
              onClick={async () => {
                await signOut();
                navigate(`/accept-invite?token=${token}`, { replace: true });
              }}
            >
              Sign out and continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>You've been invited</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{invitation.email}</span> · role:{' '}
            <span className="font-medium text-foreground">{invitation.role}</span>
          </p>
          {orgNames.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              Dealerships: <span className="text-foreground">{orgNames.join(', ')}</span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {user ? (
            <p className="text-sm text-muted-foreground">Accepting invitation…</p>
          ) : (
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="full-name">Full name</Label>
                <Input id="full-name" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Choose a password</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                <p className="text-xs text-muted-foreground">At least 8 characters.</p>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Creating account...' : 'Create account & accept'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Already have an account?{' '}
                <button type="button" className="underline" onClick={() => navigate(`/auth?next=/accept-invite?token=${token}`)}>
                  Sign in
                </button>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
