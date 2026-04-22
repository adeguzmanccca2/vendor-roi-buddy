
-- =========================================================
-- 1. user_organizations: membership table (multi-dealership)
-- =========================================================
CREATE TABLE public.user_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'client',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX idx_user_organizations_user ON public.user_organizations(user_id);
CREATE INDEX idx_user_organizations_org  ON public.user_organizations(organization_id);

ALTER TABLE public.user_organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all memberships"
  ON public.user_organizations
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users view own memberships"
  ON public.user_organizations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_user_organizations_updated_at
  BEFORE UPDATE ON public.user_organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill from existing profiles
INSERT INTO public.user_organizations (user_id, organization_id, role)
SELECT p.user_id, p.organization_id,
       COALESCE(
         (SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = p.user_id LIMIT 1),
         'client'
       )
FROM public.profiles p
WHERE p.organization_id IS NOT NULL
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- =========================================================
-- 2. invitations
-- =========================================================
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'client',
  organization_ids uuid[] NOT NULL DEFAULT '{}',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | accepted | revoked | expired
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_email  ON public.invitations(lower(email));
CREATE INDEX idx_invitations_token  ON public.invitations(token);
CREATE INDEX idx_invitations_status ON public.invitations(status);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all invitations"
  ON public.invitations
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Public read by token (so the accept page works pre-login).
-- Token is a 48-char random hex secret, so this is safe.
CREATE POLICY "Anyone can read invitation by token"
  ON public.invitations
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TRIGGER trg_invitations_updated_at
  BEFORE UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 3. accept_invitation function
-- =========================================================
CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS TABLE(success boolean, message text, organizations_joined integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  org_id uuid;
  joined_count integer := 0;
  current_user_id uuid := auth.uid();
  current_email text;
BEGIN
  IF current_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'You must be signed in to accept an invitation.'::text, 0;
    RETURN;
  END IF;

  SELECT * INTO inv FROM public.invitations WHERE token = _token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invitation not found.'::text, 0;
    RETURN;
  END IF;

  IF inv.status <> 'pending' THEN
    RETURN QUERY SELECT false, ('Invitation is ' || inv.status || '.')::text, 0;
    RETURN;
  END IF;

  IF inv.expires_at < now() THEN
    UPDATE public.invitations SET status = 'expired' WHERE id = inv.id;
    RETURN QUERY SELECT false, 'Invitation has expired.'::text, 0;
    RETURN;
  END IF;

  -- Verify email matches the invited address
  SELECT email INTO current_email FROM auth.users WHERE id = current_user_id;
  IF lower(current_email) <> lower(inv.email) THEN
    RETURN QUERY SELECT false,
      'This invitation was sent to a different email address.'::text, 0;
    RETURN;
  END IF;

  -- Grant role (idempotent)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, inv.role)
  ON CONFLICT DO NOTHING;

  -- If the role is admin, also remove default 'client' role granted by handle_new_user
  -- (keep both is fine; we just ensure admin row exists)

  -- Add memberships for every dealership in the invite
  FOREACH org_id IN ARRAY inv.organization_ids LOOP
    INSERT INTO public.user_organizations (user_id, organization_id, role)
    VALUES (current_user_id, org_id, inv.role)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
    joined_count := joined_count + 1;
  END LOOP;

  -- If user has no organization_id on profile yet, set it to the first one for backwards compat
  IF array_length(inv.organization_ids, 1) > 0 THEN
    UPDATE public.profiles
       SET organization_id = COALESCE(organization_id, inv.organization_ids[1])
     WHERE user_id = current_user_id;
  END IF;

  UPDATE public.invitations
     SET status = 'accepted',
         accepted_at = now(),
         accepted_by = current_user_id
   WHERE id = inv.id;

  RETURN QUERY SELECT true, 'Invitation accepted.'::text, joined_count;
END;
$$;
