// Password reset that sends through Brevo's API instead of Supabase's SMTP.
//
// WHY this exists: Supabase's own resetPasswordForEmail() has been returning
// 500 "Error sending recovery email" for this project. Its SMTP relay never
// successfully authenticates to Brevo (Brevo records zero logins against the
// SMTP key), while Brevo's REST API works reliably — it is what invite-user
// and the inbound-email DMS notifications already use. So we generate the
// recovery link ourselves with the service-role key and deliver it over the
// path that is known to work.
//
// generateLink() creates the link WITHOUT sending anything, which is exactly
// what we need: Supabase mints the token, Brevo does the delivery.
//
// SCOPE: this covers password reset only. Signup-confirmation emails still go
// through Supabase's SMTP and remain broken until that is fixed or they get
// the same treatment.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const RESET_PATH = '/reset-password';

async function sendBrevoEmail(params: {
  apiKey: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; error: string | null }> {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': params.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Vendor ROI', email: 'noreply@logos-tek.com' },
        to: [{ email: params.to }],
        subject: params.subject,
        htmlContent: params.html,
      }),
    });
    const responseText = await res.text();
    if (!res.ok) return { sent: false, error: `Brevo HTTP ${res.status}: ${responseText}` };
    return { sent: true, error: null };
  } catch (e) {
    return { sent: false, error: `fetch error: ${(e as Error).name}: ${(e as Error).message}` };
  }
}

function resetEmailHtml(actionLink: string): string {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111">
      <h2 style="margin-top:0">Reset your password</h2>
      <p>We received a request to reset the password for your Vendor ROI account.</p>
      <p style="margin:32px 0">
        <a href="${actionLink}"
           style="background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600">
          Reset password
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280">
        Or copy this link into your browser:<br>
        <span style="color:#2563eb;word-break:break-all">${actionLink}</span>
      </p>
      <p style="font-size:12px;color:#6b7280;margin-top:32px">
        This link expires in one hour. If you did not request a password reset,
        you can safely ignore this email — your password will not change.
      </p>
    </div>
  `;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoApiKey = process.env.BREVO_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !brevoApiKey) {
    console.error('[auth/reset-password] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / BREVO_API_KEY');
    return res.status(500).json({ error: 'Password reset is not configured' });
  }

  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
  const email = rawEmail.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  // Where the emailed link lands. Falls back to the known production host so a
  // misconfigured env var can't send people to a broken origin. Never taken
  // from the request body — that would let anyone point reset links at a host
  // they control and harvest the recovery token.
  const origin = (process.env.DASHBOARD_URL ?? 'https://roi.autoadvisoragent.com').replace(/\/$/, '');

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${origin}${RESET_PATH}` },
    });

    // WHY errors here are swallowed into a generic success: the most common
    // one is "user not found", and reporting that back would turn this
    // endpoint into a way to test which email addresses have accounts.
    // Genuine failures are logged server-side instead.
    if (error || !data?.properties?.action_link) {
      console.error('[auth/reset-password] generateLink failed:', error?.message ?? 'no action_link returned');
      return res.status(200).json({ ok: true });
    }

    const sent = await sendBrevoEmail({
      apiKey: brevoApiKey,
      to: email,
      subject: 'Reset your Vendor ROI password',
      html: resetEmailHtml(data.properties.action_link),
    });

    if (!sent.sent) {
      // Delivery genuinely failed — worth surfacing, since unlike "user not
      // found" this is not something the caller could have caused, and
      // silently claiming success would leave them waiting for an email that
      // is never going to arrive.
      console.error('[auth/reset-password] Brevo send failed:', sent.error);
      return res.status(502).json({ error: 'Could not send the reset email. Please try again shortly.' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[auth/reset-password] unexpected failure:', (e as Error).message);
    return res.status(500).json({ error: 'Something went wrong sending the reset email' });
  }
}
