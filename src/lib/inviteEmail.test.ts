import { describe, expect, it } from 'vitest';

import { resolveInviteEmailProvider } from './inviteEmail';

describe('resolveInviteEmailProvider', () => {
  it('prefers brevo when a key is configured', () => {
    expect(resolveInviteEmailProvider({ BREVO_API_KEY: 'brevo-key' })).toBe('brevo');
  });

  it('falls back to supabase auth when brevo is unavailable but the service role key exists', () => {
    expect(resolveInviteEmailProvider({ SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' })).toBe('supabase-auth');
  });

  it('returns none when no provider is configured', () => {
    expect(resolveInviteEmailProvider({})).toBe('none');
  });
});
