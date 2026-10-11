-- CRM lead import (CRM Leads Upload page + CRM files on the inbound email
-- route). A CRM export lists leads salespeople entered, each with a
-- "Lead Provider" that maps to a vendor through source_mapping_rules.
--
-- Idempotent: safe to re-run from the SQL editor.

-- 1. Where a lead came from. 'vendor' = the vendor's own file / webhook /
--    email (everything before this migration); 'crm' = a lead the CRM had
--    that no vendor file did. Lets reports show how many leads only the CRM
--    knew about, per vendor.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_origin TEXT NOT NULL DEFAULT 'vendor';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_lead_origin_check') THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_lead_origin_check CHECK (lead_origin IN ('vendor', 'crm'));
  END IF;
END $$;

-- 2. Set when a CRM row matched this (vendor) lead instead of creating a new
--    one -- i.e. the CRM confirms the vendor's lead. Blank fields on the lead
--    may have been filled from the CRM row at the same time.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS crm_matched_at TIMESTAMPTZ;

-- 3. "Skip" rules: a source mapping rule with no vendor means rows with that
--    Lead Provider are not imported at all (e.g. "Service").
ALTER TABLE public.source_mapping_rules
  ALTER COLUMN vendor_id DROP NOT NULL;

-- 4. apply_source_mapping_for_org: unchanged from 20260917000000 except that
--    a skip rule (vendor_id IS NULL) never assigns -- if the best-priority
--    match for a lead is a skip rule, the lead is left as it is.
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
    ORDER BY l.id, r.priority ASC, (r.match_type = 'exact') DESC
  )
  UPDATE public.leads l
     SET vendor_id = rm.vendor_id
    FROM rule_matches rm
   WHERE l.id = rm.lead_id
     AND rm.vendor_id IS NOT NULL;
  GET DIAGNOSTICS upd = ROW_COUNT;

  RETURN QUERY SELECT upd, total;
END;
$$;
