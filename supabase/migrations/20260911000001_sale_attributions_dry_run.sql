-- Read-only preview of what the (not-yet-written) write-capable matching
-- function would insert into sale_attributions, so the output can be
-- reviewed in the Supabase SQL editor before any write-capable version
-- exists. This function performs zero writes -- it is pure SELECT wrapped
-- in a RETURN QUERY, nothing here touches sale_attributions except to read
-- from it (see the final NOT EXISTS below).
--
-- Same priority order as the GOAL: VIN -> Stock# -> Email -> Phone, each
-- tier excluding any (sale, vendor) pair a higher-priority tier already
-- found for that sale, so a vendor is never proposed twice for the same
-- sale even if it matches on more than one field or has more than one
-- matching lead (DISTINCT ON (sale_id, vendor_id) picks a single lead per
-- vendor per sale, breaking ties by most recent lead_date).
--
-- Also excludes anything already present in sale_attributions, so what
-- this returns is the true incremental diff a real run would produce right
-- now -- not a full re-derivation that happens to overlap with existing
-- rows. And it excludes sales with manual_override = true, mirroring the
-- guard both existing "pick one winner" engines already use (see
-- attribute_sales_for_org and Sales.tsx's matchLeads) -- a sale a human
-- has manually pinned to a vendor is left alone.
--
-- VEHICLE-CONFLICT GUARD (Email/Phone tiers only), ported from the
-- dropVehicleConflicts helper in Sales.tsx's matchLeads: a fleet or repeat
-- buyer shares one email/phone across many unrelated purchases, so an
-- email or phone hit alone is not proof the lead is about THIS vehicle.
-- When the sale carries its own VIN (or Stock#) AND the candidate lead
-- carries one too AND they differ, that lead is provably about a different
-- vehicle and is dropped. A missing value on either side is not a conflict
-- -- absence of evidence is not evidence of mismatch, so those still match.
-- The VIN and Stock# tiers are both exempt from this guard: each is treated
-- as vehicle proof in its own right, so nothing is allowed to override them.
-- They are simply ordered -- VIN is tried first, and the Stock# tier skips
-- any (sale, vendor) pair VIN already credited, so a vendor is recorded
-- under its strongest matching field and never credited twice.
--
-- LEAD TIMING. Stock#/Email/Phone tiers require lead_date <= sale_date: a
-- lead that arrived after the sale cannot have caused it. The VIN tier is
-- deliberately looser -- a 90-day grace window past the sale date -- because
-- a VIN match proves the vendor was working that exact vehicle, and VIN-keyed
-- campaign feeds report on a lag. See the inline note on the vin_matches CTE.
--
-- ONE-SALE CAP FOR VEHICLE-LESS LEADS (also ported from Sales.tsx): the
-- conflict guard above can only reject a lead that PROVES it belongs to
-- another vehicle. A lead carrying no VIN and no stock# ("Private Caller"
-- phone-ups, bare web forms) can never be disproven that way, yet a fleet
-- buyer using one phone number can generate many separate sales. Such a
-- lead is limited to the single closest-dated sale; see the `ranked` and
-- `capped` CTEs below.
-- DROP first: CREATE OR REPLACE cannot change a function's return type, so
-- re-running this after adding columns to RETURNS TABLE would fail without it.
DROP FUNCTION IF EXISTS public.preview_sale_attributions_for_org(UUID);

CREATE OR REPLACE FUNCTION public.preview_sale_attributions_for_org(_org_id UUID)
RETURNS TABLE (
  sale_id UUID,
  vendor_id UUID,
  vendor_name TEXT,
  lead_id UUID,
  matched_on TEXT,
  confidence INTEGER,
  sale_customer TEXT,
  sale_date TIMESTAMPTZ,
  sale_price NUMERIC,
  sale_vin TEXT,
  sale_stock TEXT,
  lead_customer TEXT,
  lead_date TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Membership-aware: admin, service role, or a member of this org via
  -- user_organizations. Deliberately NOT "get_user_org(auth.uid()) = _org_id"
  -- -- that resolves to a single org from profiles and locks a client out of
  -- every dealership but their first. See 20260911000003.
  IF NOT public.user_can_access_org(_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', _org_id;
  END IF;

  RETURN QUERY
  WITH eligible_sales AS (
    SELECT s.*
    FROM public.sales s
    WHERE s.organization_id = _org_id
      AND s.manual_override = false
  ),
  vin_matches AS (
    SELECT DISTINCT ON (s.id, l.vendor_id)
      s.id AS sale_id, l.vendor_id, l.id AS lead_id,
      'vin'::TEXT AS matched_on, 100 AS confidence
    FROM eligible_sales s
    JOIN public.leads l
      ON l.organization_id = s.organization_id
     AND l.vendor_id IS NOT NULL
     AND NULLIF(TRIM(l.vin), '') IS NOT NULL
     AND UPPER(TRIM(l.vin)) = UPPER(TRIM(s.vin))
     -- VIN tier gets a 90-day GRACE WINDOW past the sale date, unlike the
     -- other tiers' strict lead_date <= sale_date. Two reasons, both seen in
     -- the data: (1) VIN-keyed campaign feeds (Lotlinx) carry a reporting
     -- date, not an inquiry date, so a row can legitimately post days after
     -- the vehicle sold while the advertising clearly ran before it; (2) a
     -- listing keeps drawing other shoppers for a while after it sells, and
     -- a vendor working that exact VIN earns the credit regardless of which
     -- shopper's name landed on the lead row. The window is not unbounded on
     -- purpose: a truck can be traded back in and re-listed months later, and
     -- those fresh leads must not credit the ORIGINAL sale. Tune the 90 days
     -- if re-listings start showing up as false credits.
     AND (l.lead_date IS NULL OR s.sale_date IS NULL
          OR l.lead_date <= s.sale_date + INTERVAL '90 days')
    WHERE NULLIF(TRIM(s.vin), '') IS NOT NULL
    ORDER BY s.id, l.vendor_id, l.lead_date DESC NULLS LAST
  ),
  stock_matches AS (
    SELECT DISTINCT ON (s.id, l.vendor_id)
      s.id AS sale_id, l.vendor_id, l.id AS lead_id,
      'stock'::TEXT AS matched_on, 95 AS confidence
    FROM eligible_sales s
    JOIN public.leads l
      ON l.organization_id = s.organization_id
     AND l.vendor_id IS NOT NULL
     AND NULLIF(TRIM(l.stock_number), '') IS NOT NULL
     AND UPPER(TRIM(l.stock_number)) = UPPER(TRIM(s.stock_number))
     AND (l.lead_date IS NULL OR s.sale_date IS NULL OR l.lead_date <= s.sale_date)
     -- NOTE: no vehicle-conflict guard here, by design. A stock# match is
     -- treated as vehicle proof in its own right, same as a VIN -- so a
     -- differing VIN on the lead does NOT disqualify it. The only ordering
     -- rule is that VIN wins first: the NOT EXISTS below skips any
     -- (sale, vendor) pair the VIN tier already credited, so a vendor is
     -- recorded under its strongest matching field and never counted twice.
    WHERE NULLIF(TRIM(s.stock_number), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM vin_matches v WHERE v.sale_id = s.id AND v.vendor_id = l.vendor_id
      )
    ORDER BY s.id, l.vendor_id, l.lead_date DESC NULLS LAST
  ),
  email_matches AS (
    SELECT DISTINCT ON (s.id, l.vendor_id)
      s.id AS sale_id, l.vendor_id, l.id AS lead_id,
      'email'::TEXT AS matched_on, 90 AS confidence
    FROM eligible_sales s
    JOIN public.leads l
      ON l.organization_id = s.organization_id
     AND l.vendor_id IS NOT NULL
     AND l.normalized_email IS NOT NULL
     AND l.normalized_email = s.normalized_email
     AND (l.lead_date IS NULL OR s.sale_date IS NULL OR l.lead_date <= s.sale_date)
     -- Vehicle-conflict guard (see header note): a fleet/repeat buyer's shared
     -- email must not drag a lead about a DIFFERENT vehicle onto this sale.
     AND NOT (
       NULLIF(TRIM(s.vin), '') IS NOT NULL AND NULLIF(TRIM(l.vin), '') IS NOT NULL
       AND UPPER(TRIM(l.vin)) <> UPPER(TRIM(s.vin))
     )
     AND NOT (
       NULLIF(TRIM(s.stock_number), '') IS NOT NULL AND NULLIF(TRIM(l.stock_number), '') IS NOT NULL
       AND UPPER(TRIM(l.stock_number)) <> UPPER(TRIM(s.stock_number))
     )
    WHERE s.normalized_email IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM vin_matches v WHERE v.sale_id = s.id AND v.vendor_id = l.vendor_id)
      AND NOT EXISTS (SELECT 1 FROM stock_matches v WHERE v.sale_id = s.id AND v.vendor_id = l.vendor_id)
    ORDER BY s.id, l.vendor_id, l.lead_date DESC NULLS LAST
  ),
  phone_matches AS (
    SELECT DISTINCT ON (s.id, l.vendor_id)
      s.id AS sale_id, l.vendor_id, l.id AS lead_id,
      'phone'::TEXT AS matched_on, 75 AS confidence
    FROM eligible_sales s
    JOIN public.leads l
      ON l.organization_id = s.organization_id
     AND l.vendor_id IS NOT NULL
     AND l.normalized_phone IS NOT NULL
     AND l.normalized_phone = s.normalized_phone
     AND (l.lead_date IS NULL OR s.sale_date IS NULL OR l.lead_date <= s.sale_date)
     -- Vehicle-conflict guard (see header note): same reasoning as the email
     -- tier -- a shared/fleet phone number must not pull in another vehicle.
     AND NOT (
       NULLIF(TRIM(s.vin), '') IS NOT NULL AND NULLIF(TRIM(l.vin), '') IS NOT NULL
       AND UPPER(TRIM(l.vin)) <> UPPER(TRIM(s.vin))
     )
     AND NOT (
       NULLIF(TRIM(s.stock_number), '') IS NOT NULL AND NULLIF(TRIM(l.stock_number), '') IS NOT NULL
       AND UPPER(TRIM(l.stock_number)) <> UPPER(TRIM(s.stock_number))
     )
    WHERE s.normalized_phone IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM vin_matches v WHERE v.sale_id = s.id AND v.vendor_id = l.vendor_id)
      AND NOT EXISTS (SELECT 1 FROM stock_matches v WHERE v.sale_id = s.id AND v.vendor_id = l.vendor_id)
      AND NOT EXISTS (SELECT 1 FROM email_matches v WHERE v.sale_id = s.id AND v.vendor_id = l.vendor_id)
    ORDER BY s.id, l.vendor_id, l.lead_date DESC NULLS LAST
  ),
  all_matches AS (
    SELECT * FROM vin_matches
    UNION ALL SELECT * FROM stock_matches
    UNION ALL SELECT * FROM email_matches
    UNION ALL SELECT * FROM phone_matches
  ),
  -- ONE-SALE CAP FOR VEHICLE-LESS LEADS (ported from Sales.tsx matchLeads).
  -- A lead with NO VIN and NO stock# that matched only on email/phone has
  -- zero vehicle evidence behind it. A fleet or repeat buyer calls once and
  -- then buys several trucks, so letting that single generic lead claim
  -- every one of those sales overstates the vendor exactly as badly as a VIN
  -- conflict would -- there is just no VIN available to prove it. Such a
  -- lead is therefore allowed to claim only ONE sale: the closest-dated one.
  -- The rest are left uncredited for manual review rather than guessed at.
  ranked AS (
    SELECT
      m.sale_id, m.vendor_id, m.lead_id, m.matched_on, m.confidence,
      l.vin AS lead_vin, l.stock_number AS lead_stock,
      ROW_NUMBER() OVER (
        PARTITION BY m.lead_id
        ORDER BY ABS(EXTRACT(EPOCH FROM (s.sale_date - l.lead_date))) ASC NULLS LAST
      ) AS lead_sale_rank
    FROM all_matches m
    JOIN public.leads l ON l.id = m.lead_id
    JOIN public.sales s ON s.id = m.sale_id
  ),
  capped AS (
    SELECT r.sale_id, r.vendor_id, r.lead_id, r.matched_on, r.confidence
    FROM ranked r
    WHERE
      -- VIN/Stock# tier matches carry their own vehicle proof -- never capped.
      r.matched_on IN ('vin', 'stock')
      -- A lead that names a vehicle is specific enough to claim several sales.
      OR NULLIF(TRIM(r.lead_vin), '') IS NOT NULL
      OR NULLIF(TRIM(r.lead_stock), '') IS NOT NULL
      -- Vehicle-less lead: only its closest-dated sale survives.
      OR r.lead_sale_rank = 1
  )
  SELECT
    m.sale_id, m.vendor_id, v.name AS vendor_name, m.lead_id, m.matched_on, m.confidence,
    s.customer_full_name AS sale_customer, s.sale_date, s.sale_price,
    s.vin AS sale_vin, s.stock_number AS sale_stock,
    l.customer_full_name AS lead_customer, l.lead_date
  FROM capped m
  JOIN public.sales s ON s.id = m.sale_id
  JOIN public.vendors v ON v.id = m.vendor_id
  JOIN public.leads l ON l.id = m.lead_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sale_attributions existing
    WHERE existing.sale_id = m.sale_id AND existing.vendor_id = m.vendor_id
  )
  ORDER BY s.customer_full_name, m.sale_id, m.confidence DESC;
END;
$$;

COMMENT ON FUNCTION public.preview_sale_attributions_for_org(UUID) IS
  'Read-only dry run: returns exactly the rows a real run of the '
  'write-capable multi-vendor matcher would insert into sale_attributions '
  'right now for this org. Zero writes. Run from the SQL editor as: '
  'select * from preview_sale_attributions_for_org(''<org-uuid>'');';
