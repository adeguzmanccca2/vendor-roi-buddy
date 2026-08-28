-- Harden accept_invitation's email comparison:
--  * trim + lower both sides (invites created outside the edge function may carry whitespace)
--  * tolerate a null auth.users.email instead of silently falling through the <> comparison
--  * name both addresses in the error so the user knows which account to sign in as
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
  IF current_email IS NULL
     OR lower(btrim(current_email)) <> lower(btrim(inv.email)) THEN
    RETURN QUERY SELECT false,
      ('This invitation was sent to ' || inv.email ||
       ', but you are signed in as ' || COALESCE(current_email, 'an account with no email') ||
       '. Sign out and accept it as ' || inv.email || '.')::text, 0;
    RETURN;
  END IF;

  -- Grant role (idempotent)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, inv.role)
  ON CONFLICT DO NOTHING;

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
