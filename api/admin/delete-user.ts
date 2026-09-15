// Deletes a user account. Admin-only.
//
// WHY server-side: removing an auth user requires the service-role key, which
// can never be exposed to the browser.
//
// AUTHORISATION differs from api/auth/accept-invite-signup.ts: there, holding
// a valid invite token was the authorisation. Here there is no such token, so
// the caller's own JWT is verified and checked for the admin role before
// anything is touched. An unauthenticated or non-admin caller gets nothing.
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
    console.error(`[admin/delete-user] missing env var(s): ${missing.join(', ')}`);
    return res.status(500).json({ error: `Not configured (missing: ${missing.join(', ')})` });
  }

  const authHeader = req.headers.authorization ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return res.status(401).json({ error: 'Not authenticated' });

  const targetUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  if (!targetUserId) return res.status(400).json({ error: 'userId is required' });

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 1. Who is calling? Validating the JWT with the service-role client
    // avoids needing the anon key configured here as well.
    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller?.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // 2. Are they an admin? Checked against user_roles rather than trusting
    // anything sent by the client.
    //
    // Deliberately limit(1) rather than maybeSingle(): nothing guarantees a
    // user has only one 'admin' row, and maybeSingle() errors outright when
    // it finds more than one. Duplicates are irrelevant to the question being
    // asked -- "does this user have the admin role at all" -- and should not
    // be able to block a legitimate admin.
    const { data: roleRows, error: roleErr } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.user.id)
      .eq('role', 'admin')
      .limit(1);

    if (roleErr) {
      console.error('[admin/delete-user] role check failed:', roleErr.message);
      return res.status(500).json({
        error: 'Could not verify permissions',
        detail: roleErr.message,
      });
    }
    if (!roleRows || roleRows.length === 0) {
      return res.status(403).json({ error: 'Admin role required' });
    }

    // 3. Refuse self-deletion. An admin removing their own account could lock
    // the last administrator out of the system entirely, and it is far more
    // likely to be a misclick than an intention.
    if (targetUserId === caller.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // 4. user_organizations has NO foreign key to auth.users (see migration
    // 20260422165640), so unlike profiles and user_roles it does not cascade
    // -- without this the membership rows would be left orphaned.
    const { error: memErr } = await admin
      .from('user_organizations')
      .delete()
      .eq('user_id', targetUserId);

    if (memErr) {
      console.error('[admin/delete-user] membership cleanup failed:', memErr.message);
      return res.status(500).json({ error: 'Could not remove dealership memberships' });
    }

    // 5. Delete the account. profiles and user_roles cascade from here.
    const { error: delErr } = await admin.auth.admin.deleteUser(targetUserId);
    if (delErr) {
      console.error('[admin/delete-user] deleteUser failed:', delErr.message);
      return res.status(500).json({ error: `Could not delete the user: ${delErr.message}` });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[admin/delete-user] unexpected failure:', (e as Error).message);
    return res.status(500).json({ error: 'Something went wrong deleting the user' });
  }
}
