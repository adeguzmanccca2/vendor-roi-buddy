-- Finish the multi-dealership access fix started in 20260911000003
-- (sale_attributions) and 20260913000000 (dms_import_logs), which both left
-- this note: "the same single-org assumption exists in the sales/leads/vendors
-- RLS policies ... Flagged for a follow-up." This is that follow-up.
--
-- Root cause, once more: get_user_org() reads profiles.organization_id, a
-- single column that predates user_organizations. A client invited to two
-- rooftops has a row per rooftop in user_organizations, but get_user_org()
-- only ever returns the one on their profile -- so every table still written
-- as "organization_id = get_user_org(auth.uid())" silently returns zero rows
-- on their second dealership onwards, even though useActiveOrg lets them
-- select it. The dashboard just looks empty.
--
-- user_can_access_org() (20260911000003) already resolves membership properly
-- and keeps get_user_org() as a fallback for legacy profile-only users, so
-- this migration is a mechanical swap of the predicate on every remaining
-- table. No policy gains or loses an operation; only the org test changes.
--
-- NOTE on the credential tables: a user who belongs to several dealerships
-- can now read and rotate the API keys of each of them, rather than only the
-- one on their profile. That is the intended meaning of membership here --
-- it matches what the app already lets them do with leads and sales -- but it
-- is a real widening, so restrict membership accordingly.
--
-- Idempotent: every new policy name is dropped before being created, so this
-- can be re-run safely from the SQL editor.

-- =========================================================
-- vendors
-- =========================================================
DROP POLICY IF EXISTS "Clients view own org vendors"   ON public.vendors;
DROP POLICY IF EXISTS "Clients insert own org vendors" ON public.vendors;
DROP POLICY IF EXISTS "Clients update own org vendors" ON public.vendors;
DROP POLICY IF EXISTS "Clients delete own org vendors" ON public.vendors;
DROP POLICY IF EXISTS "Members view their orgs vendors"   ON public.vendors;
DROP POLICY IF EXISTS "Members insert their orgs vendors" ON public.vendors;
DROP POLICY IF EXISTS "Members update their orgs vendors" ON public.vendors;
DROP POLICY IF EXISTS "Members delete their orgs vendors" ON public.vendors;

CREATE POLICY "Members view their orgs vendors" ON public.vendors
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs vendors" ON public.vendors
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id));

CREATE POLICY "Members update their orgs vendors" ON public.vendors
  FOR UPDATE TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members delete their orgs vendors" ON public.vendors
  FOR DELETE TO authenticated
  USING (public.user_can_access_org(organization_id));

-- =========================================================
-- leads
-- =========================================================
DROP POLICY IF EXISTS "Clients view own org leads"   ON public.leads;
DROP POLICY IF EXISTS "Clients insert own org leads" ON public.leads;
DROP POLICY IF EXISTS "Clients update own org leads" ON public.leads;
DROP POLICY IF EXISTS "Clients delete own org leads" ON public.leads;
DROP POLICY IF EXISTS "Members view their orgs leads"   ON public.leads;
DROP POLICY IF EXISTS "Members insert their orgs leads" ON public.leads;
DROP POLICY IF EXISTS "Members update their orgs leads" ON public.leads;
DROP POLICY IF EXISTS "Members delete their orgs leads" ON public.leads;

CREATE POLICY "Members view their orgs leads" ON public.leads
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id));

CREATE POLICY "Members update their orgs leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members delete their orgs leads" ON public.leads
  FOR DELETE TO authenticated
  USING (public.user_can_access_org(organization_id));

-- =========================================================
-- raw_lead_uploads
-- =========================================================
DROP POLICY IF EXISTS "Clients view own org uploads"   ON public.raw_lead_uploads;
DROP POLICY IF EXISTS "Clients insert own org uploads" ON public.raw_lead_uploads;
DROP POLICY IF EXISTS "Members view their orgs lead uploads"   ON public.raw_lead_uploads;
DROP POLICY IF EXISTS "Members insert their orgs lead uploads" ON public.raw_lead_uploads;

CREATE POLICY "Members view their orgs lead uploads" ON public.raw_lead_uploads
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

-- uploaded_by = auth.uid() is preserved: an upload row must still be
-- attributed to the person who actually made it.
CREATE POLICY "Members insert their orgs lead uploads" ON public.raw_lead_uploads
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id) AND uploaded_by = auth.uid());

-- =========================================================
-- sales
-- =========================================================
DROP POLICY IF EXISTS "Clients view own org sales"   ON public.sales;
DROP POLICY IF EXISTS "Clients insert own org sales" ON public.sales;
DROP POLICY IF EXISTS "Clients update own org sales" ON public.sales;
DROP POLICY IF EXISTS "Clients delete own org sales" ON public.sales;
DROP POLICY IF EXISTS "Members view their orgs sales"   ON public.sales;
DROP POLICY IF EXISTS "Members insert their orgs sales" ON public.sales;
DROP POLICY IF EXISTS "Members update their orgs sales" ON public.sales;
DROP POLICY IF EXISTS "Members delete their orgs sales" ON public.sales;

CREATE POLICY "Members view their orgs sales" ON public.sales
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs sales" ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id));

CREATE POLICY "Members update their orgs sales" ON public.sales
  FOR UPDATE TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members delete their orgs sales" ON public.sales
  FOR DELETE TO authenticated
  USING (public.user_can_access_org(organization_id));

-- =========================================================
-- raw_sales_uploads
-- =========================================================
DROP POLICY IF EXISTS "Clients view own org sales uploads"   ON public.raw_sales_uploads;
DROP POLICY IF EXISTS "Clients insert own org sales uploads" ON public.raw_sales_uploads;
DROP POLICY IF EXISTS "Members view their orgs sales uploads"   ON public.raw_sales_uploads;
DROP POLICY IF EXISTS "Members insert their orgs sales uploads" ON public.raw_sales_uploads;

CREATE POLICY "Members view their orgs sales uploads" ON public.raw_sales_uploads
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs sales uploads" ON public.raw_sales_uploads
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id) AND uploaded_by = auth.uid());

-- =========================================================
-- source_mapping_rules
-- =========================================================
DROP POLICY IF EXISTS "Clients view own org source rules"   ON public.source_mapping_rules;
DROP POLICY IF EXISTS "Clients insert own org source rules" ON public.source_mapping_rules;
DROP POLICY IF EXISTS "Clients update own org source rules" ON public.source_mapping_rules;
DROP POLICY IF EXISTS "Clients delete own org source rules" ON public.source_mapping_rules;
DROP POLICY IF EXISTS "Members view their orgs source rules"   ON public.source_mapping_rules;
DROP POLICY IF EXISTS "Members insert their orgs source rules" ON public.source_mapping_rules;
DROP POLICY IF EXISTS "Members update their orgs source rules" ON public.source_mapping_rules;
DROP POLICY IF EXISTS "Members delete their orgs source rules" ON public.source_mapping_rules;

CREATE POLICY "Members view their orgs source rules" ON public.source_mapping_rules
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs source rules" ON public.source_mapping_rules
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id));

CREATE POLICY "Members update their orgs source rules" ON public.source_mapping_rules
  FOR UPDATE TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members delete their orgs source rules" ON public.source_mapping_rules
  FOR DELETE TO authenticated
  USING (public.user_can_access_org(organization_id));

-- =========================================================
-- vendor_inventory
-- =========================================================
DROP POLICY IF EXISTS "Clients view own org inventory"   ON public.vendor_inventory;
DROP POLICY IF EXISTS "Clients insert own org inventory" ON public.vendor_inventory;
DROP POLICY IF EXISTS "Clients update own org inventory" ON public.vendor_inventory;
DROP POLICY IF EXISTS "Clients delete own org inventory" ON public.vendor_inventory;
DROP POLICY IF EXISTS "Members view their orgs inventory"   ON public.vendor_inventory;
DROP POLICY IF EXISTS "Members insert their orgs inventory" ON public.vendor_inventory;
DROP POLICY IF EXISTS "Members update their orgs inventory" ON public.vendor_inventory;
DROP POLICY IF EXISTS "Members delete their orgs inventory" ON public.vendor_inventory;

CREATE POLICY "Members view their orgs inventory" ON public.vendor_inventory
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs inventory" ON public.vendor_inventory
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id));

CREATE POLICY "Members update their orgs inventory" ON public.vendor_inventory
  FOR UPDATE TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members delete their orgs inventory" ON public.vendor_inventory
  FOR DELETE TO authenticated
  USING (public.user_can_access_org(organization_id));

-- =========================================================
-- raw_inventory_uploads
-- =========================================================
DROP POLICY IF EXISTS "Clients view own org inventory uploads"   ON public.raw_inventory_uploads;
DROP POLICY IF EXISTS "Clients insert own org inventory uploads" ON public.raw_inventory_uploads;
DROP POLICY IF EXISTS "Members view their orgs inventory uploads"   ON public.raw_inventory_uploads;
DROP POLICY IF EXISTS "Members insert their orgs inventory uploads" ON public.raw_inventory_uploads;

CREATE POLICY "Members view their orgs inventory uploads" ON public.raw_inventory_uploads
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs inventory uploads" ON public.raw_inventory_uploads
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id) AND uploaded_by = auth.uid());

-- =========================================================
-- api_credentials
-- =========================================================
DROP POLICY IF EXISTS "Clients manage own org api credentials" ON public.api_credentials;
DROP POLICY IF EXISTS "Members manage their orgs api credentials" ON public.api_credentials;

CREATE POLICY "Members manage their orgs api credentials"
  ON public.api_credentials FOR ALL TO authenticated
  USING (public.user_can_access_org(organization_id))
  WITH CHECK (public.user_can_access_org(organization_id));

-- =========================================================
-- cdk_fortellis_credentials
-- =========================================================
DROP POLICY IF EXISTS "Clients manage own org cdk fortellis credentials" ON public.cdk_fortellis_credentials;
DROP POLICY IF EXISTS "Members manage their orgs cdk fortellis credentials" ON public.cdk_fortellis_credentials;

CREATE POLICY "Members manage their orgs cdk fortellis credentials"
  ON public.cdk_fortellis_credentials FOR ALL TO authenticated
  USING (public.user_can_access_org(organization_id))
  WITH CHECK (public.user_can_access_org(organization_id));

-- =========================================================
-- apply_source_mapping_for_org
--
-- The last remaining "get_user_org(auth.uid()) = _org_id" guard. Body is
-- unchanged from 20260421185608; only the authorization check is re-pointed,
-- so a multi-rooftop user can re-run source mapping on their second
-- dealership instead of hitting 'Not authorized for organization ...'.
-- =========================================================
CREATE OR REPLACE FUNCTION public.apply_source_mapping_for_org(_org_id uuid)
RETURNS TABLE(updated_count integer, total_unmapped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  upd INTEGER := 0;
  total INTEGER := 0;
BEGIN
  IF NOT public.user_can_access_org(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', _org_id;
  END IF;

  SELECT COUNT(*) INTO total FROM public.leads
   WHERE organization_id = _org_id
     AND vendor_id IS NULL
     AND source_label IS NOT NULL
     AND manual_override = false;

  WITH rule_matches AS (
    SELECT DISTINCT ON (l.id)
      l.id AS lead_id, r.vendor_id
    FROM public.leads l
    JOIN public.source_mapping_rules r
      ON r.organization_id = l.organization_id
     AND r.is_active = true
     AND (
       (r.match_type = 'exact'    AND lower(l.source_label) = lower(r.pattern))
       OR
       (r.match_type = 'contains' AND lower(l.source_label) LIKE '%' || lower(r.pattern) || '%')
     )
    WHERE l.organization_id = _org_id
      AND l.vendor_id IS NULL
      AND l.source_label IS NOT NULL
      AND l.manual_override = false
    ORDER BY l.id, r.priority ASC
  )
  UPDATE public.leads l
     SET vendor_id = rm.vendor_id
    FROM rule_matches rm
   WHERE l.id = rm.lead_id;
  GET DIAGNOSTICS upd = ROW_COUNT;

  RETURN QUERY SELECT upd, total;
END;
$$;
