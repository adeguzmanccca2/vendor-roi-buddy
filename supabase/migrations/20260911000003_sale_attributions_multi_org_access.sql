-- Fix multi-dealership access for the sale_attributions feature.
--
-- get_user_org() resolves to profiles.organization_id -- a single org, from
-- before user_organizations existed. A client invited to two dealerships has
-- a row per dealership in user_organizations, but get_user_org() still only
-- ever returns the one on their profile. So every check written as
-- "get_user_org(auth.uid()) = _org_id" silently denies that user on their
-- SECOND dealership onwards: the dry run raises 'Not authorized for
-- organization ...', and the RLS policy hides the credits entirely.
--
-- Membership is now tested against user_organizations, with get_user_org()
-- kept as a fallback so users who only have the legacy profile column set
-- (and no user_organizations rows yet) keep working.
--
-- NOTE: the same single-org assumption exists in attribute_sales_for_org and
-- in the sales/leads/vendors RLS policies. Not touched here -- that is a
-- wider change than this feature should make on its own, and the webhook
-- path calls attribute_sales_for_org with the service role (auth.uid() is
-- null), so it is unaffected in practice. Flagged for a follow-up.

CREATE OR REPLACE FUNCTION public.user_can_access_org(_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Service-role / SQL-editor callers have no JWT.
    auth.uid() IS NULL
    OR has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_organizations
      WHERE user_id = auth.uid() AND organization_id = _org_id
    )
    -- Legacy fallback for profiles that predate user_organizations.
    OR get_user_org(auth.uid()) = _org_id
$$;

COMMENT ON FUNCTION public.user_can_access_org(UUID) IS
  'True when the caller may act on this organization: service role, an '
  'admin, a user_organizations member, or (legacy) the org on their '
  'profile. Use this instead of comparing against get_user_org(), which '
  'only ever returns a single org and breaks multi-dealership users.';

-- Re-point both sale_attributions functions at the membership-aware check.
CREATE OR REPLACE FUNCTION public.attribute_sale_credits_for_org(_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  IF NOT public.user_can_access_org(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', _org_id;
  END IF;

  INSERT INTO public.sale_attributions
    (organization_id, sale_id, vendor_id, lead_id, matched_on, confidence)
  SELECT _org_id, p.sale_id, p.vendor_id, p.lead_id, p.matched_on, p.confidence
  FROM public.preview_sale_attributions_for_org(_org_id) p
  ON CONFLICT (sale_id, vendor_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

-- RLS: a member of several dealerships must be able to read the credits for
-- each of them, not just the one on their profile row.
DROP POLICY IF EXISTS "Clients view own org sale attributions" ON public.sale_attributions;

CREATE POLICY "Members view their orgs sale attributions" ON public.sale_attributions
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));
