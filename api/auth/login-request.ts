// Step 1 of two-factor login: verify the password, then email a one-time code.
//
// WHY the password is checked HERE rather than in the browser: if the client
// called signInWithPassword() it would immediately hold a fully valid
// session, and the "second factor" would only be a screen standing in front
// of an already-authenticated user. Verifying server-side and discarding the
// resulting session means the browser gets nothing at all until the code is
// confirmed -- the code is a real gate, not a UI speed bump.
//
// WHY Supabase still generates the code: generateLink() returns an email_otp
// alongside the link, and Supabase owns its lifetime, single use and
// attempt limits. Only delivery moves to Brevo, because Supabase's own SMTP
// relay cannot authenticate to Brevo (see api/auth/reset-password.ts). That
// avoids hand-rolling a code table, hashing, expiry and brute-force
// protection -- all of which are easy to get subtly wrong.
//
// Step 2 is client-side: supabase.auth.verifyOtp({ email, token,
// type: 'magiclink' }), which mints the session in the browser.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const CODE_TTL_NOTE = 'This code expires shortly and can only be used once.';

// Two buckets, because they stop different things. The per-email bucket is the
// brute-force limit: it caps guesses against one account no matter how many
// addresses the attacker comes from. The per-IP bucket is the abuse limit: it
// stops one source spraying many addresses, which the email bucket alone would
// never notice. IP is the looser of the two so a dealership behind one office
// NAT does not lock itself out.
const EMAIL_MAX_ATTEMPTS = 8;
const IP_MAX_ATTEMPTS = 30;
const RATE_WINDOW_SECONDS = 15 * 60;

// x-forwarded-for is a client-supplied header everywhere except behind a proxy
// that overwrites it. Vercel does overwrite it, and the real client is the
// FIRST entry; later entries are attacker-controllable and must not be trusted.
function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return raw?.split(',')[0]?.trim() || 'unknown';
}

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

function codeEmailHtml(code: string): string {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111">
      <h2 style="margin-top:0">Your sign-in code</h2>
      <p>Use this code to finish signing in to Vendor ROI:</p>
      <p style="margin:28px 0">
        <span style="display:inline-block;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;
                     padding:16px 28px;font-size:30px;letter-spacing:8px;font-weight:700;color:#18181b">
          ${code}
        </span>
      </p>
      <p style="font-size:12px;color:#6b7280">${CODE_TTL_NOTE}</p>
      <p style="font-size:12px;color:#6b7280;margin-top:28px">
        If you did not try to sign in, someone may have your password —
        change it as soon as you can. This code alone does not give them access.
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
    const missing = [
      !supabaseUrl && 'SUPABASE_URL',
      !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
      !brevoApiKey && 'BREVO_API_KEY',
    ].filter(Boolean);
    console.error(`[auth/login-request] missing env var(s): ${missing.join(', ')}`);
    return res.status(500).json({ error: `Sign-in is not configured (missing: ${missing.join(', ')})` });
  }

  const email = (typeof req.body?.email === 'string' ? req.body.email : '').trim().toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Consumes an attempt whether or not the password turns out to be right, so
  // guessing is what gets rate limited -- checking only failures would let an
  // attacker probe freely until the moment they succeed.
  //
  // Fails OPEN: if the counter itself errors (most likely the migration not
  // being applied yet) sign-in keeps working and the problem is logged, rather
  // than every user being locked out by an infrastructure fault. The error is
  // loud precisely because this is the state where there is no protection.
  const underLimit = async (key: string, max: number): Promise<boolean> => {
    const { data, error } = await admin.rpc('check_auth_rate_limit', {
      _key: key,
      _max_attempts: max,
      _window_seconds: RATE_WINDOW_SECONDS,
    });
    if (error) {
      console.error('[auth/login-request] rate limit check failed open:', error.message);
      return true;
    }
    return data !== false;
  };

  try {
    const ip = clientIp(req);
    const [ipOk, emailOk] = await Promise.all([
      underLimit(`login:ip:${ip}`, IP_MAX_ATTEMPTS),
      underLimit(`login:email:${email}`, EMAIL_MAX_ATTEMPTS),
    ]);

    if (!ipOk || !emailOk) {
      // Identical message either way: saying which bucket tripped would reveal
      // whether this specific address is being targeted.
      return res.status(429).json({
        error: 'Too many sign-in attempts. Please wait a few minutes and try again.',
      });
    }

    // 1. Verify the password. The session this returns is deliberately thrown
    // away -- it exists only to prove the credentials are right, and never
    // leaves this function.
    //
    // The service-role key is used as the apikey header purely to identify
    // the project; the grant itself still succeeds or fails on the supplied
    // credentials alone, so this grants no elevated access.
    const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: serviceRoleKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!tokenRes.ok) {
      // Same response for a wrong password and an unknown address, so this
      // cannot be used to discover which emails have accounts.
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 2. Have Supabase mint a one-time code. generateLink does NOT send
    // anything, which is exactly what is wanted here.
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    const code = data?.properties?.email_otp;
    if (error || !code) {
      console.error('[auth/login-request] generateLink failed:', error?.message ?? 'no email_otp returned');
      return res.status(500).json({ error: 'Could not start sign-in. Please try again.' });
    }

    // 3. Deliver it ourselves.
    const sent = await sendBrevoEmail({
      apiKey: brevoApiKey,
      to: email,
      subject: `${code} is your Vendor ROI sign-in code`,
      html: codeEmailHtml(code),
    });

    if (!sent.sent) {
      // Surfaced rather than hidden: the password was correct, so silently
      // failing would strand a legitimate user on a code screen waiting for
      // an email that is never coming.
      console.error('[auth/login-request] Brevo send failed:', sent.error);
      return res.status(502).json({
        error: 'Could not send your sign-in code.',
        detail: sent.error,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[auth/login-request] unexpected failure:', (e as Error).message);
    return res.status(500).json({ error: 'Something went wrong starting sign-in' });
  }
}
