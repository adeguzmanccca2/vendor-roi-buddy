import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const passwordSchema = z
  .string()
  .min(8, { message: 'Password must be at least 8 characters' })
  .max(72);

type SessionState = 'checking' | 'valid' | 'invalid';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    // Supabase parses the recovery token from the URL hash on client init,
    // then fires PASSWORD_RECOVERY (and establishes a session). Listen for
    // the event in case it fires after mount, and also poll getSession() now.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY' || session) {
          setSessionState('valid');
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionState(prev => (prev === 'valid' ? prev : session ? 'valid' : 'invalid'));
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwRes = passwordSchema.safeParse(password);
    if (!pwRes.success) return toast.error(pwRes.error.errors[0].message);
    if (password !== confirmPassword) return toast.error('Passwords do not match');

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwRes.data });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }

    toast.success('Password updated. Please sign in with your new password.');
    await supabase.auth.signOut();
    setBusy(false);
    navigate('/auth', { replace: true });
  };

  if (sessionState === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Reset link invalid</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              This password reset link is invalid or has expired. Request a new one from the sign in page.
            </p>
            <Button onClick={() => navigate('/auth')} className="w-full">
              Back to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <p className="text-sm text-muted-foreground">Enter and confirm your new password.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={busy || sessionState === 'checking'}
            >
              {busy ? 'Updating...' : 'Update password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
