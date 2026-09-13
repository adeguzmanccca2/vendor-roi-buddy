-- Extend the multi-dealership access fix (20260911000003) to
-- dms_import_logs. Same root cause: "organization_id = get_user_org(auth.uid())"
-- resolves to a single org from profiles, so a client invited to more than
-- one dealership could only ever see import logs for the org on their
-- profile row, never the others they're a member of via user_organizations.
DROP POLICY IF EXISTS "Clients view own org dms import logs" ON public.dms_import_logs;

CREATE POLICY "Members view their orgs dms import logs"
  ON public.dms_import_logs FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));
