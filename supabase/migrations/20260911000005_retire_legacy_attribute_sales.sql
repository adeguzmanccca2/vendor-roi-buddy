-- Retire the old single-winner matcher by turning it into a forwarder.
--
-- attribute_sales_for_org used its own rules (email 95% -> phone 80%, no VIN,
-- no stock#, none of the guards) and wrote the legacy single-vendor columns
-- on `sales`. Those columns are no longer shown anywhere, and the rules were
-- superseded by the VIN -> Stock# -> Email -> Phone matcher.
--
-- WHY replace the body instead of deleting the function: the deployed
-- `receive-sales` edge function calls it by name, and edge functions only
-- change on a `supabase functions deploy`. Rewriting the body here means
-- that already-deployed caller starts using the new matcher immediately,
-- with no redeploy and no CLI access required. The signature is unchanged so
-- nothing calling it breaks.
--
-- It no longer writes sales.vendor_id / lead_id / attribution_status /
-- attribution_confidence at all, so every attribution the old engine
-- produced stays frozen exactly as it was -- consistent with the rule that
-- existing attributions are never rewritten.
CREATE OR REPLACE FUNCTION public.attribute_sales_for_org(_org_id UUID)
RETURNS TABLE(matched INTEGER, total_unmatched INTEGER)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  credits_added   INTEGER := 0;
  still_uncredited INTEGER := 0;
BEGIN
  IF NOT public.user_can_access_org(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', _org_id;
  END IF;

  -- All matching rules live in preview_sale_attributions_for_org; this is
  -- just the insert wrapper around it.
  SELECT public.attribute_sale_credits_for_org(_org_id) INTO credits_added;

  -- Keep the historical meaning of the second column: sales still carrying
  -- no vendor credit at all after this run.
  SELECT COUNT(*) INTO still_uncredited
  FROM public.sales s
  WHERE s.organization_id = _org_id
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_attributions sa WHERE sa.sale_id = s.id
    );

  RETURN QUERY SELECT credits_added, still_uncredited;
END;
$$;

COMMENT ON FUNCTION public.attribute_sales_for_org(UUID) IS
  'DEPRECATED shim. Forwards to attribute_sale_credits_for_org() so the '
  'already-deployed receive-sales edge function picks up the multi-vendor '
  'matcher without a redeploy. Returns (new credits inserted, sales still '
  'with no credit). No longer writes the legacy sales.vendor_id / lead_id / '
  'attribution_status columns. New callers should use '
  'attribute_sale_credits_for_org directly.';
