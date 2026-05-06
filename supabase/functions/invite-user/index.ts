// Admin-only: create an invitation row + send an invite email via Brevo.
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
  redirectOrigin: string;
}

async function sendBrevoEmail(
  apiKey: string,
  to: string,
  acceptUrl: string,
): Promise<{ sent: boolean; error: string | null }> {
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111">
      <h2 style="margin-top:0">You've been invited to Vendor ROI</h2>
      <p>Click the button below to create your account and get started.</p>
      <p style="margin:32px 0">
        <a href="${acceptUrl}"
           style="background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600">
          Accept invitation
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280">
        Or copy this link into your browser:<br>
        <span style="color:#2563eb">${acceptUrl}</span>
      </p>
      <p style="font-size:12px;color:#6b7280;margin-top:32px">
        This invitation expires in 14 days. If you did not expect this email, you can safely ignore it.
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Vendor ROI', email: 'noreply@logos-tek.com' },
        to: [{ email: to }],
        subject: "You've been invited to Vendor ROI",
        htmlContent: html,
      }),
    });

    const responseText = await res.text();
    if (!res.ok) {
      return { sent: false, error: `Brevo HTTP ${res.status}: ${responseText}` };
    }
    return { sent: true, error: null };
  } catch (e) {
    return { sent: false, error: `fetch error: ${(e as Error).name}: ${(e as Error).message}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth' }, 401);

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

    // Send invite email via Brevo
    let emailSent = false;
    let emailError: string | null = null;

    if (!BREVO_API_KEY) {
      emailError = 'BREVO_API_KEY secret is not set';
    } else {
      const result = await sendBrevoEmail(BREVO_API_KEY, email, acceptUrl);
      emailSent = result.sent;
      emailError = result.error;
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
