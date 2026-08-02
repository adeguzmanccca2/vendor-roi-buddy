import { describe, expect, it } from 'vitest';

import { getSupabaseErrorMessage } from './supabaseError';

describe('getSupabaseErrorMessage', () => {
  it('returns a friendly message for fetch failures', () => {
    expect(getSupabaseErrorMessage('Failed to fetch')).toContain('could not reach the Supabase service');
  });

  it('preserves other auth error messages', () => {
    expect(getSupabaseErrorMessage('Invalid login credentials')).toBe('Invalid login credentials');
  });
});
