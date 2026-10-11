-- Saved CRM column mapping, one per dealership. Saved by the CRM Leads Upload
-- page when a file is imported, and reused by the inbound email route, so a
-- dealership whose CRM names its columns differently ("Lead Source",
-- "Created", "Mobile") is set up by mapping one file by hand -- no code
-- change per CRM. `mapping` is { field key -> column header }, keys as in
-- CRM_FIELDS in src/lib/crmLeads.ts (provider, lead_date, email, phone, ...).
--
-- Idempotent: safe to re-run from the SQL editor.
CREATE TABLE IF NOT EXISTS public.crm_column_mappings (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  mapping JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_column_mappings ENABLE ROW LEVEL SECURITY;

-- Same membership-aware predicate as the core tables (20260917000000).
DROP POLICY IF EXISTS "Members view their orgs crm mapping"   ON public.crm_column_mappings;
DROP POLICY IF EXISTS "Members insert their orgs crm mapping" ON public.crm_column_mappings;
DROP POLICY IF EXISTS "Members update their orgs crm mapping" ON public.crm_column_mappings;
DROP POLICY IF EXISTS "Members delete their orgs crm mapping" ON public.crm_column_mappings;

CREATE POLICY "Members view their orgs crm mapping" ON public.crm_column_mappings
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs crm mapping" ON public.crm_column_mappings
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id));

CREATE POLICY "Members update their orgs crm mapping" ON public.crm_column_mappings
  FOR UPDATE TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members delete their orgs crm mapping" ON public.crm_column_mappings
  FOR DELETE TO authenticated
  USING (public.user_can_access_org(organization_id));
