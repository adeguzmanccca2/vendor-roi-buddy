-- Fix invitations RLS: close open SELECT policy, add scoped policies, create secure token lookup

-- 1. Drop the wide-open SELECT policy
DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.invitations;

-- 2. Authenticated users can only see invitations addressed to their own email
--    Admins are already covered by the existing "Admins manage all invitations" FOR ALL policy
CREATE POLICY "Users can view own invitations"
  ON public.invitations
  FOR SELECT
  TO authenticated
  USING (email = (SELECT email FROM public.profiles WHERE user_id = auth.uid()));

-- 3. Secure RPC for token-based lookup — runs as SECURITY DEFINER so it
--    bypasses RLS and works for both anon (pre-login) and authenticated users
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token text)
RETURNS TABLE (
  id               uuid,
  email            text,
  role             public.app_role,
  status           text,
  organization_ids uuid[],
  expires_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.role,
    i.status,
    i.organization_ids,
    i.expires_at
  FROM public.invitations i
  WHERE i.token = _token;
END;
$$;

-- 4. Grant execute to anon (needed before the user logs in) and authenticated
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;
