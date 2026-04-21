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

const emailSchema = z.string().trim().email({ message: 'Invalid email' }).max(255);
const passwordSchema = z.string().min(8, { message: 'Password must be at least 8 characters' }).max(72);
const nameSchema = z.string().trim().min(1, { message: 'Name required' }).max(100);

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  // login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // signup
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailRes = emailSchema.safeParse(loginEmail);
    if (!emailRes.success) return toast.error(emailRes.error.errors[0].message);
    if (!loginPassword) return toast.error('Password required');

    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: emailRes.data,
      password: loginPassword,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message);
      return;
    }
    toast.success('Signed in');
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
      toast.error(error.message.includes('already registered') ? 'Email already registered' : error.message);
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
              </form>
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
