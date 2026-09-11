import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getSupabaseErrorMessage } from '@/lib/supabaseError';

const emailSchema = z.string().trim().email({ message: 'Invalid email' }).max(255);
const passwordSchema = z.string().min(8, { message: 'Password must be at least 8 characters' }).max(72);
const nameSchema = z.string().trim().min(1, { message: 'Name required' }).max(100);
const otpSchema = z.string().trim().regex(/^\d{6}$/, { message: 'Enter the 6-digit code' });

type LoginView = 'signin' | 'forgot' | 'otp';

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  // login
  const [loginView, setLoginView] = useState<LoginView>('signin');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // email verification code (required 2nd factor after password)
  // WHY otpPending, set BEFORE the password check even starts: signInWithPassword
  // briefly creates a real session the instant it succeeds, and the redirect effect
  // below would otherwise fire on that session before we get a chance to sign it
  // back out and demand the emailed code. Arming the guard first closes that window.
  const [otpPending, setOtpPending] = useState(false);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');

  // forgot password
  const [forgotEmail, setForgotEmail] = useState('');

  // signup
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  useEffect(() => {
    if (!loading && user && !otpPending) navigate('/', { replace: true });
  }, [user, loading, navigate, otpPending]);

  const resetToSignIn = () => {
    setOtpPending(false);
    setOtpCode('');
    setLoginPassword('');
    setLoginView('signin');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailRes = emailSchema.safeParse(loginEmail);
    if (!emailRes.success) return toast.error(emailRes.error.errors[0].message);
    if (!loginPassword) return toast.error('Password required');

    setOtpPending(true); // arm the redirect guard before any auth call runs
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: emailRes.data,
      password: loginPassword,
    });
    if (error) {
      setOtpPending(false);
      setBusy(false);
      toast.error(error.message === 'Invalid login credentials' ? 'Invalid email or password' : getSupabaseErrorMessage(error));
      return;
    }

    // Password is correct, but don't let the app treat this as a completed
    // login yet — drop the session and require the emailed code first.
    await supabase.auth.signOut();
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: emailRes.data,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (otpErr) {
      setOtpPending(false);
      toast.error('Could not send verification code: ' + getSupabaseErrorMessage(otpErr));
      return;
    }
    setOtpEmail(emailRes.data);
    setLoginView('otp');
    toast.success('Check your email for a 6-digit verification code');
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const codeRes = otpSchema.safeParse(otpCode);
    if (!codeRes.success) return toast.error(codeRes.error.errors[0].message);

    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email: otpEmail,
      token: codeRes.data,
      type: 'email',
    });
    setBusy(false);
    if (error) {
      toast.error(getSupabaseErrorMessage(error) || 'Invalid or expired code');
      return;
    }
    setOtpPending(false); // let the redirect effect take over now that it's verified
    toast.success('Signed in');
  };

  const handleResendOtp = async () => {
    if (!otpEmail) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: otpEmail,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) {
      toast.error('Could not resend code: ' + getSupabaseErrorMessage(error));
      return;
    }
    toast.success('New code sent');
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailRes = emailSchema.safeParse(forgotEmail);
    if (!emailRes.success) return toast.error(emailRes.error.errors[0].message);

    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailRes.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Check your email for a reset link');
    setForgotEmail('');
    setLoginView('signin');
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameRes = nameSchema.safeParse(signupName);
    const emailRes = emailSchema.safeParse(signupEmail);
    const pwRes = passwordSchema.safeParse(signupPassword);
    if (!nameRes.success) return toast.error(nameRes.error.errors[0].message);
    if (!emailRes.success) return toast.error(emailRes.error.errors[0].message);
    if (!pwRes.success) return toast.error(pwRes.error.errors[0].message);

    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: emailRes.data,
      password: pwRes.data,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: nameRes.data },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes('already registered') ? 'Email already registered' : getSupabaseErrorMessage(error));
      return;
    }
    toast.success('Check your email to verify your account before signing in.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Vendor ROI Tracker</CardTitle>
          <p className="text-sm text-muted-foreground">Multi-dealership attribution platform</p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              {loginView === 'signin' && (
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
              )}

              {loginView === 'forgot' && (
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

              {loginView === 'otp' && (
                <form onSubmit={handleVerifyOtp} className="space-y-4 pt-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold">Enter verification code</h2>
                    <p className="text-sm text-muted-foreground">
                      We sent a 6-digit code to <span className="font-medium text-foreground">{otpEmail}</span>.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="otp-code">Verification code</Label>
                    <Input
                      id="otp-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="123456"
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? 'Verifying...' : 'Verify & Sign In'}
                  </Button>
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={busy}
                      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Resend code
                    </button>
                    <button
                      type="button"
                      onClick={resetToSignIn}
                      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      ← Back to sign in
                    </button>
                  </div>
                </form>
              )}
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full name</Label>
                  <Input id="signup-name" value={signupName} onChange={e => setSignupName(e.target.value)} autoComplete="name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)} autoComplete="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input id="signup-password" type="password" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} autoComplete="new-password" />
                  <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Creating account...' : 'Create Account'}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  You'll need to verify your email before signing in.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
