// Creates the account for someone accepting an invitation, server-side.
//
// WHY this exists: AcceptInvite.tsx used supabase.auth.signUp(), the same
// public endpoint that lets anyone self-register. Closing public signup
// (disable_signup) would therefore have broken invite acceptance too. This
// moves account creation behind the service-role key, so signup can be
// switched off while invited users can still get in.
//
// WHY it is safe to expose without auth: it will only ever create an account
// for an email address that already has a valid, pending, unexpired
// invitation -- and that address is read from the invitation row, never from
// the request body. Possession of an invite token is the authorisation. A
// caller cannot create an account for an arbitrary address.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [
      !supabaseUrl && 'SUPABASE_URL',
      !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean);
    console.error(`[auth/accept-invite-signup] missing env var(s): ${missing.join(', ')}`);
    return res.status(500).json({ error: `Not configured (missing: ${missing.join(', ')})` });
  }

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';

  if (!token) return res.status(400).json({ error: 'Invitation token is required' });
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be between 8 and 72 characters' });
  }
  if (!fullName) return res.status(400).json({ error: 'Full name is required' });

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // The invitation is the authorisation AND the source of the email address.
    // Taking the address from the request body instead would let anyone with
    // any valid token create an account for an address of their choosing.
    const { data: invitation, error: invErr } = await admin
      .from('invitations')
      .select('id, email, status, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (invErr) {
      console.error('[auth/accept-invite-signup] invitation lookup failed:', invErr.message);
      return res.status(500).json({ error: 'Could not verify the invitation' });
    }
    if (!invitation) {
      return res.status(404).json({ error: 'This invitation link is invalid or has been revoked' });
    }
    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: 'This invitation is no longer pending' });
    }
    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired. Please ask for a new one.' });
    }

    const { error: createErr } = await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      // Invitations are themselves proof the address is reachable -- it is
      // where the invite was delivered -- so there is nothing to confirm.
      // This also matches the project's existing mailer_autoconfirm setting.
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createErr) {
      // Already registered: not an error worth failing on. The client signs
      // in with the password they just typed and accepts the invite from
      // there, matching the previous behaviour of the signUp() path.
      const msg = createErr.message.toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        return res.status(200).json({ ok: true, alreadyExisted: true, email: invitation.email });
      }
      console.error('[auth/accept-invite-signup] createUser failed:', createErr.message);
      return res.status(500).json({ error: 'Could not create the account' });
    }

    // The invitation itself is NOT marked accepted here. That still happens
    // through accept_invitation() once the client has a session, so role and
    // organization membership are granted under the invited user's own
    // identity rather than by this endpoint.
    return res.status(200).json({ ok: true, alreadyExisted: false, email: invitation.email });
  } catch (e) {
    console.error('[auth/accept-invite-signup] unexpected failure:', (e as Error).message);
    return res.status(500).json({ error: 'Something went wrong creating the account' });
  }
}
