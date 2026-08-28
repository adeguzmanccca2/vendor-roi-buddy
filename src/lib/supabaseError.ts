export function getSupabaseErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const message = rawMessage.trim();

  if (!message) return 'Something went wrong while contacting Supabase.';

  if (/failed to fetch|fetch failed|network error|networkrequestfailed/i.test(message)) {
    return 'We could not reach the Supabase service. Please check your connection or the configured project URL.';
  }

  return message;
}
