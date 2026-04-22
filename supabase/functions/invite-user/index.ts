// Admin-only: create an invitation row + send a Supabase Auth invite email.
// The email links to our app where /accept-invite?token=... finalizes role + dealership memberships.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface InvitePayload {
  email: string;
  role: 'admin' | 'client';
  organizationIds: string[];
  redirectOrigin: string; // e.g. https://your-app.lovable.app
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing auth' }, 401);
    }

    // Validate caller is an admin using their JWT
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: 'Unauthorized' }, 401);

    const { data: isAdmin, error: roleErr } = await userClient.rpc('has_role', {
      _user_id: userRes.user.id,
      _role: 'admin',
    });
    if (roleErr || !isAdmin) return json({ error: 'Admin role required' }, 403);

    const body = (await req.json()) as InvitePayload;
    const email = (body.email ?? '').trim().toLowerCase();
    const role = body.role === 'admin' ? 'admin' : 'client';
    const orgIds = Array.isArray(body.organizationIds) ? body.organizationIds : [];
    const origin = body.redirectOrigin?.replace(/\/$/, '') ?? '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Valid email required' }, 400);
    }
    if (orgIds.length === 0) {
      return json({ error: 'At least one dealership is required' }, 400);
    }
    if (!origin) return json({ error: 'redirectOrigin required' }, 400);

    // Service-role client for privileged ops
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Insert invitation row
    const { data: inv, error: insertErr } = await admin
      .from('invitations')
      .insert({
        email,
        role,
        organization_ids: orgIds,
        invited_by: userRes.user.id,
      })
      .select('id, token')
      .single();

    if (insertErr || !inv) {
      return json({ error: insertErr?.message ?? 'Failed to create invitation' }, 500);
    }

    const acceptUrl = `${origin}/accept-invite?token=${inv.token}`;

    // Try to send Supabase Auth invite email (uses platform default templates)
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: acceptUrl,
        data: { invitation_token: inv.token, full_name: email.split('@')[0] },
      });
      if (inviteErr) {
        // If user already exists, fall through and just return the link.
        emailError = inviteErr.message;
      } else {
        emailSent = true;
      }
    } catch (e) {
      emailError = (e as Error).message;
    }

    return json({
      success: true,
      invitationId: inv.id,
      acceptUrl,
      emailSent,
      emailError,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
