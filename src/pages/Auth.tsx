import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getSupabaseErrorMessage } from '@/lib/supabaseError';

const emailSchema = z.string().trim().email({ message: 'Invalid email' }).max(255);
const codeSchema = z.string().trim().regex(/^\d{6}$/, { message: 'Enter the 6-digit code' });

type LoginView = 'signin' | 'code' | 'forgot';

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  // login
  const [loginView, setLoginView] = useState<LoginView>('signin');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // two-factor code
  const [code, setCode] = useState('');

  // forgot password
  const [forgotEmail, setForgotEmail] = useState('');


  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  // Step 1: the password is checked SERVER-side by /api/auth/login-request,
  // which discards the session it gets back. Nothing is established in the
  // browser here, so there is no authenticated state sitting behind the code
  // screen waiting to be skipped -- the session only comes into existence in
  // handleVerifyCode below.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailRes = emailSchema.safeParse(loginEmail);
    if (!emailRes.success) return toast.error(emailRes.error.errors[0].message);
    if (!loginPassword) return toast.error('Password required');

    setBusy(true);
    try {
      const res = await fetch('/api/auth/login-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailRes.data, password: loginPassword }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(body?.detail ? `${body.error} ${body.detail}` : (body?.error ?? 'Could not sign in'));
        return;
      }

      setCode('');
      setLoginView('code');
      toast.success('We emailed you a 6-digit sign-in code');
    } catch {
      toast.error('Could not reach the server. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  // Step 2: exchanging the emailed code for the actual session. Supabase
  // minted this code (via generateLink server-side) so it owns its expiry,
  // single use and attempt limits -- we only changed how it was delivered.
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const codeRes = codeSchema.safeParse(code);
    if (!codeRes.success) return toast.error(codeRes.error.errors[0].message);

    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email: emailSchema.parse(loginEmail),
      token: codeRes.data,
      type: 'magiclink',
    });
    setBusy(false);

    if (error) {
      toast.error(getSupabaseErrorMessage(error) || 'That code is invalid or has expired');
      return;
    }
    toast.success('Signed in');
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailRes = emailSchema.safeParse(forgotEmail);
    if (!emailRes.success) return toast.error(emailRes.error.errors[0].message);

    setBusy(true);
    try {
      // Goes through our own endpoint rather than
      // supabase.auth.resetPasswordForEmail: Supabase's SMTP relay fails to
      // authenticate to Brevo and returns 500 "Error sending recovery email".
      // /api/auth/reset-password mints the same recovery link server-side and
      // delivers it over Brevo's REST API, which is the path invites already
      // use successfully. See api/auth/reset-password.ts.
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailRes.data }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? 'Could not send the reset email. Please try again.');
        return;
      }

      // Deliberately the same message whether or not an account exists —
      // the endpoint reports success either way so this page can't be used
      // to discover which email addresses are registered.
      toast.success('If that email has an account, a reset link is on its way.');
      setForgotEmail('');
      setLoginView('signin');
    } catch {
      toast.error('Could not reach the server. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Vendor ROI Tracker</CardTitle>
          <p className="text-sm text-muted-foreground">Multi-dealership attribution platform</p>
        </CardHeader>
        {/* Sign-up is deliberately absent: accounts are created only by
            invitation (admin Invite User -> /accept-invite). Public
            self-registration is also disabled server-side, so removing this
            form isn't cosmetic -- there is no open signup path behind it. */}
        <CardContent>
          {loginView === 'code' ? (
                <form onSubmit={handleVerifyCode} className="space-y-4 pt-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold">Enter your sign-in code</h2>
                    <p className="text-sm text-muted-foreground">
                      We emailed a 6-digit code to{' '}
                      <span className="font-medium text-foreground">{loginEmail}</span>.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-code">Verification code</Label>
                    <Input
                      id="login-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="123456"
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      autoFocus
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? 'Verifying...' : 'Verify & Sign In'}
                  </Button>
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={handleLogin}
                      disabled={busy}
                      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Resend code
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLoginView('signin'); setCode(''); setLoginPassword(''); }}
                      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      ← Back to sign in
                    </button>
                  </div>
                </form>
              ) : loginView === 'signin' ? (
                <form onSubmit={handleLogin} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input id="login-email" type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} autoComplete="email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input id="login-password" type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} autoComplete="current-password" />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? 'Signing in...' : 'Sign In'}
                  </Button>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setLoginView('forgot')}
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4 pt-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold">Reset your password</h2>
                    <p className="text-sm text-muted-foreground">
                      Enter your email and we&apos;ll send you a reset link.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">Email</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? 'Sending...' : 'Send reset link'}
                  </Button>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setLoginView('signin')}
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      ← Back to sign in
                    </button>
                  </div>
            </form>
          )}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Accounts are created by invitation only. Contact your administrator
            if you need access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
