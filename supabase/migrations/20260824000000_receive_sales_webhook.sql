-- Support a public `receive-sales` webhook (mirrors `receive-leads`) so dealership IT
-- can push a sales export file on a schedule (e.g. via a curl/PowerShell script) instead
-- of manually using the CSV upload UI or needing FTP.

-- Usage counter for the sales webhook, parallel to the existing lead_count.
ALTER TABLE public.api_credentials
  ADD COLUMN IF NOT EXISTS sale_count INTEGER NOT NULL DEFAULT 0;

-- Allow attribute_sales_for_org to be called with the service-role key (auth.uid() is
-- null in that context) so the receive-sales edge function can auto-attribute newly
-- ingested sales to leads/vendors right after insert. The edge function already scopes
-- every call to the organization_id resolved from the caller's api_credentials row, so
-- this does not widen access for authenticated (non-service-role) callers.
CREATE OR REPLACE FUNCTION public.attribute_sales_for_org(_org_id UUID)
RETURNS TABLE(matched INTEGER, total_unmatched INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_count INTEGER := 0;
  total_count INTEGER := 0;
BEGIN
  -- Permission check
  IF NOT (auth.uid() IS NULL OR has_role(auth.uid(), 'admin') OR get_user_org(auth.uid()) = _org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', _org_id;
  END IF;

  SELECT COUNT(*) INTO total_count FROM public.sales
   WHERE organization_id = _org_id AND attribution_status = 'unmatched' AND manual_override = false;

  -- Match by email first (highest confidence)
  WITH email_matches AS (
    SELECT DISTINCT ON (s.id)
      s.id AS sale_id, l.id AS lead_id, l.vendor_id, 95 AS confidence
    FROM public.sales s
    JOIN public.leads l
      ON l.organization_id = s.organization_id
     AND l.normalized_email IS NOT NULL
     AND l.normalized_email = s.normalized_email
     AND (l.lead_date IS NULL OR s.sale_date IS NULL OR l.lead_date <= s.sale_date)
    WHERE s.organization_id = _org_id
      AND s.attribution_status = 'unmatched'
      AND s.manual_override = false
      AND s.normalized_email IS NOT NULL
    ORDER BY s.id, l.lead_date DESC NULLS LAST
  )
  UPDATE public.sales s
     SET lead_id = em.lead_id,
         vendor_id = COALESCE(s.vendor_id, em.vendor_id),
         attribution_status = 'auto',
         attribution_confidence = em.confidence
    FROM email_matches em
   WHERE s.id = em.sale_id;
  GET DIAGNOSTICS match_count = ROW_COUNT;

  -- Then phone matches for remaining
  WITH phone_matches AS (
    SELECT DISTINCT ON (s.id)
      s.id AS sale_id, l.id AS lead_id, l.vendor_id, 80 AS confidence
    FROM public.sales s
    JOIN public.leads l
      ON l.organization_id = s.organization_id
     AND l.normalized_phone IS NOT NULL
     AND l.normalized_phone = s.normalized_phone
     AND (l.lead_date IS NULL OR s.sale_date IS NULL OR l.lead_date <= s.sale_date)
    WHERE s.organization_id = _org_id
      AND s.attribution_status = 'unmatched'
      AND s.manual_override = false
      AND s.normalized_phone IS NOT NULL
    ORDER BY s.id, l.lead_date DESC NULLS LAST
  )
  UPDATE public.sales s
     SET lead_id = pm.lead_id,
         vendor_id = COALESCE(s.vendor_id, pm.vendor_id),
         attribution_status = 'auto',
         attribution_confidence = pm.confidence
    FROM phone_matches pm
   WHERE s.id = pm.sale_id;

  -- Mark anything still unmatched as 'none' so we know we tried
  UPDATE public.sales
     SET attribution_status = 'none'
   WHERE organization_id = _org_id
     AND attribution_status = 'unmatched'
     AND manual_override = false;

  RETURN QUERY SELECT match_count, total_count;
END;
$$;
