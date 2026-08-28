-- "Clients can view their own organization" (20260421181254) predates the
-- multi-dealership user_organizations table added in 20260422165640, and was
-- never updated: it only lets a client read the single org referenced by
-- profiles.organization_id. A client invited to 2+ dealerships via
-- accept_invitation gets rows in user_organizations for both, but RLS on
-- organizations strips out every org beyond the one legacy profile column,
-- so the org switcher (useActiveOrg) sees an empty/partial list.
CREATE POLICY "Members can view their memberships' organizations"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid()
    )
  );
