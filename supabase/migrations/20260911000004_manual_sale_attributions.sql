-- Let a human-pinned vendor live in sale_attributions alongside the
-- automatic credits, so that table is the single complete answer to "which
-- vendors are credited for this sale" and the Sales page no longer needs the
-- legacy sales.vendor_id column to show manual assignments.
--
-- WHY this is needed: the automatic matcher skips sales with
-- manual_override = true by design (see preview_sale_attributions_for_org),
-- so a manually-pinned sale gets zero credit rows. Dropping the legacy
-- column from the UI without this would make a deliberate human decision
-- invisible.

-- 'manual' joins the matched-on vocabulary.
ALTER TABLE public.sale_attributions
  DROP CONSTRAINT IF EXISTS sale_attributions_matched_on_check;

ALTER TABLE public.sale_attributions
  ADD CONSTRAINT sale_attributions_matched_on_check
  CHECK (matched_on IN ('vin', 'stock', 'email', 'phone', 'manual'));

-- A manual override can assign a vendor WITHOUT naming a lead ("this sale
-- came from Vendor A, I don't know which lead"), which the automatic path
-- never does. Auto rows still always carry the lead that justified them.
ALTER TABLE public.sale_attributions
  ALTER COLUMN lead_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Manual credit: set
--
-- SECURITY DEFINER because clients have no direct INSERT on
-- sale_attributions -- all writes go through vetted functions.
--
-- Uses DO UPDATE rather than DO NOTHING, unlike the automatic writer: a
-- person re-pinning the same sale to the same vendor is explicitly asking to
-- change it, and is the one actor allowed to. It can only ever touch a row
-- it owns -- the WHERE clause refuses to convert an automatic credit into a
-- manual one, so evidence produced by the matcher is never rewritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_manual_sale_attribution(
  _sale_id   UUID,
  _vendor_id UUID,
  _lead_id   UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id UUID;
BEGIN
  SELECT organization_id INTO _org_id FROM public.sales WHERE id = _sale_id;
  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'Sale % not found', _sale_id;
  END IF;

  IF NOT public.user_can_access_org(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', _org_id;
  END IF;

  INSERT INTO public.sale_attributions
    (organization_id, sale_id, vendor_id, lead_id, matched_on, confidence)
  VALUES (_org_id, _sale_id, _vendor_id, _lead_id, 'manual', 100)
  ON CONFLICT (sale_id, vendor_id) DO UPDATE
    SET lead_id    = EXCLUDED.lead_id,
        matched_on = 'manual',
        confidence = 100
  WHERE public.sale_attributions.matched_on = 'manual';
END;
$$;

-- ---------------------------------------------------------------------------
-- Manual credit: clear
--
-- The ONLY delete path on this table, and deliberately narrow: it removes
-- manual rows for one sale and nothing else. `matched_on = 'manual'` means
-- an automatic credit can never be deleted through this function, so the
-- "automated matching never removes an attribution" guarantee holds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_manual_sale_attribution(_sale_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id UUID;
  removed INTEGER := 0;
BEGIN
  SELECT organization_id INTO _org_id FROM public.sales WHERE id = _sale_id;
  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'Sale % not found', _sale_id;
  END IF;

  IF NOT public.user_can_access_org(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', _org_id;
  END IF;

  DELETE FROM public.sale_attributions
   WHERE sale_id = _sale_id AND matched_on = 'manual';

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

COMMENT ON FUNCTION public.set_manual_sale_attribution(UUID, UUID, UUID) IS
  'Pin a vendor to a sale by hand, recorded in sale_attributions as '
  'matched_on = ''manual''. Can only create or update a manual row -- never '
  'rewrites a credit the automatic matcher produced.';

COMMENT ON FUNCTION public.clear_manual_sale_attribution(UUID) IS
  'Remove the manual credit(s) for a sale. Scoped to matched_on = ''manual'' '
  'so automatic credits are never deleted.';
