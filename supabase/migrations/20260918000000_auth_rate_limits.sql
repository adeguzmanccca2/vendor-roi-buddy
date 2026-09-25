-- Rate limiting for /api/auth/login-request.
--
-- That endpoint is unauthenticated, verifies a password, and sends a Brevo
-- email on every success. Without a limit it is both a password brute-force
-- surface and a way to bill arbitrary email volume to our Brevo account (and
-- burn the sending domain's reputation) by replaying one valid address.
--
-- WHY a table rather than an in-memory counter: the endpoint runs as a Vercel
-- function. Instances are recycled and run concurrently, so a module-level Map
-- resets constantly and is not shared between instances -- it would look like
-- a limit while barely being one. Postgres is the only state both instances
-- already share.
--
-- Idempotent, so it can be re-run from the SQL editor.

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  bucket_key        TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count     INTEGER NOT NULL DEFAULT 0
);

-- RLS on with NO policies = no access for anon or authenticated. Only the
-- service role (which bypasses RLS) can reach this, and it does so through
-- the function below. Attempt counts are a probe for which emails exist, so
-- this table must never be client-readable.
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

-- Consumes one attempt against _key and reports whether the caller is still
-- under the limit. The whole read-modify-write is a single upsert so two
-- concurrent requests cannot both read the same count and each think they are
-- the first.
CREATE OR REPLACE FUNCTION public.check_auth_rate_limit(
  _key             TEXT,
  _max_attempts    INTEGER,
  _window_seconds  INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
BEGIN
  INSERT INTO public.auth_rate_limits AS arl (bucket_key, window_started_at, attempt_count)
  VALUES (_key, now(), 1)
  ON CONFLICT (bucket_key) DO UPDATE
    SET
      -- An expired window restarts from this attempt instead of carrying the
      -- old count forward.
      window_started_at = CASE
        WHEN arl.window_started_at < now() - make_interval(secs => _window_seconds)
          THEN now()
        ELSE arl.window_started_at
      END,
      attempt_count = CASE
        WHEN arl.window_started_at < now() - make_interval(secs => _window_seconds)
          THEN 1
        ELSE arl.attempt_count + 1
      END
  RETURNING arl.attempt_count INTO current_count;

  RETURN current_count <= _max_attempts;
END;
$$;

-- Must not be reachable from the browser: a client that could call this could
-- burn another account's quota and lock them out. Only the service role, which
-- is what the Vercel function authenticates as, may execute it.
REVOKE ALL ON FUNCTION public.check_auth_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_auth_rate_limit(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.check_auth_rate_limit(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_auth_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION public.check_auth_rate_limit(TEXT, INTEGER, INTEGER) IS
  'Consumes one attempt against bucket_key and returns true while the caller '
  'is under _max_attempts within a rolling _window_seconds. Service role only. '
  'Rows are reused per key, so the table stays bounded by distinct keys seen; '
  'purge rows with window_started_at older than a day if it ever grows.';
