-- Write-capable counterpart to preview_sale_attributions_for_org().
--
-- WHY this is a thin wrapper rather than its own copy of the matching rules:
-- the VIN -> Stock# -> Email -> Phone logic, the vehicle-conflict guards, the
-- lead-timing windows and the one-sale cap all live in exactly ONE place --
-- the preview function. This writer simply inserts whatever that preview
-- returns. There is deliberately no second implementation to drift out of
-- sync, which is the failure mode the app already had once (Sales.tsx's
-- matchLeads and attribute_sales_for_org implement different rules for the
-- same job). Change a rule in the preview and both the dry run and the real
-- run change together, by construction.
--
-- HOW "never touch an existing attribution" is enforced -- three independent
-- layers, none of which rely on the caller remembering to check:
--   1. The preview already filters out any (sale_id, vendor_id) pair present
--      in sale_attributions, so such rows are never even offered for insert.
--   2. ON CONFLICT (sale_id, vendor_id) DO NOTHING means that even if layer 1
--      were bypassed or lost a race, the database silently skips the row
--      rather than updating it. There is no DO UPDATE anywhere.
--   3. The UNIQUE (sale_id, vendor_id) constraint backing that clause is a
--      table-level guarantee -- no code path, including a future one written
--      by someone unaware of this rule, can produce a duplicate credit.
-- This function contains no UPDATE and no DELETE statement at all, and it
-- never writes to sales.vendor_id / lead_id / attribution_status /
-- attribution_confidence / match_method -- every attribution produced by the
-- older "pick one winner" engines stays exactly as it is.
--
-- Returns the number of NEW attribution rows inserted. Re-running it against
-- an unchanged dataset returns 0, which is the intended idempotent behaviour.
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
  -- Same permission shape as attribute_sales_for_org and the preview:
  -- an admin for any org, a client for their own org, or a service-role /
  -- SQL-editor caller where auth.uid() is null.
  IF NOT (auth.uid() IS NULL OR has_role(auth.uid(), 'admin') OR get_user_org(auth.uid()) = _org_id) THEN
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

COMMENT ON FUNCTION public.attribute_sale_credits_for_org(UUID) IS
  'Inserts the multi-vendor sale credits that preview_sale_attributions_for_org() '
  'proposes for this org. INSERT-only and idempotent: ON CONFLICT (sale_id, '
  'vendor_id) DO NOTHING, no UPDATE or DELETE anywhere, and the legacy '
  'sales.vendor_id/lead_id/attribution_status columns are never written. '
  'Returns the count of new rows. Run as: '
  'select attribute_sale_credits_for_org(''<org-uuid>'');';
