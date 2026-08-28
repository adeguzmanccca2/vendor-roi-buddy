export type InviteEmailProvider = 'brevo' | 'supabase-auth' | 'none';

export function resolveInviteEmailProvider(env: Record<string, string | undefined>): InviteEmailProvider {
  const hasBrevoKey = Boolean(env.BREVO_API_KEY?.trim());
  const hasSupabaseServiceRoleKey = Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim());

  if (hasBrevoKey) return 'brevo';
  if (hasSupabaseServiceRoleKey) return 'supabase-auth';
  return 'none';
}
