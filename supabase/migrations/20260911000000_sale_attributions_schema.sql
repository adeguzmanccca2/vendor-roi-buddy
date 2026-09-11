-- New table: multi-vendor sale attribution ("credit every vendor whose lead
-- legitimately matches this sale," replacing the old "pick one winner"
-- model for reporting purposes). See src/pages/Sales.tsx's matchLeads and
-- attribute_sales_for_org (20260421183524 / 20260824000000) for the two
-- existing "pick one winner" engines this supplements.
--
-- WHY a separate table instead of widening sales.vendor_id: a single column
-- (or even a vendor_id[] array) can't hold an auditable "which field, what
-- confidence, which lead" record per credited vendor — a sale attributed to
-- 3 vendors needs 3 independently-traceable rows, not one column with 3
-- values crammed in. This is a plain many-to-many join table: one row per
-- (sale, vendor) pair that has a legitimate match.
--
-- WHY sales.vendor_id / lead_id / attribution_status / attribution_confidence
-- / match_method are NOT touched by this migration, or by any of the new
-- matching functions that follow it: every attribution already written by
-- the old "pick one winner" logic — whether from Sales.tsx's Match Leads
-- button, attribute_sales_for_org, or a manual override via
-- AttributionOverrideDialog — must be preserved exactly as it is today.
-- Those columns keep meaning exactly what they meant before. This new
-- table is purely additive: a second, richer source of truth that coexists
-- with the legacy columns rather than replacing or reconciling with them.
CREATE TABLE public.sale_attributions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  matched_on TEXT NOT NULL CHECK (matched_on IN ('vin', 'stock', 'email', 'phone')),
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- STRUCTURAL enforcement of "one vendor, credited at most once per sale":
  -- this is not a convention the app has to remember to honor — Postgres
  -- itself rejects (or, with ON CONFLICT, silently no-ops) a second row for
  -- a (sale_id, vendor_id) pair that already exists, regardless of which
  -- field matched or which of that vendor's leads produced the second hit.
  -- The write-capable matching function (added in a later migration, after
  -- the dry-run has been reviewed) will INSERT ... ON CONFLICT (sale_id,
  -- vendor_id) DO NOTHING — making "never attribute a sale to the same
  -- vendor twice" and "never touch a row that already exists" the same
  -- guarantee, enforced by the database, not by application logic
  -- remembering to check first.
  UNIQUE (sale_id, vendor_id)
);

-- sale_id lookups ("which vendors are credited for this sale?") are served
-- by the UNIQUE (sale_id, vendor_id) index above, since sale_id is its
-- leading column — no separate single-column index on sale_id is needed.
CREATE INDEX idx_sale_attributions_org ON public.sale_attributions(organization_id);
CREATE INDEX idx_sale_attributions_vendor ON public.sale_attributions(organization_id, vendor_id);
CREATE INDEX idx_sale_attributions_lead ON public.sale_attributions(lead_id);

COMMENT ON TABLE public.sale_attributions IS
  'One row per (sale, vendor) pair with a legitimate VIN/Stock#/Email/Phone '
  'match. A sale can have multiple rows here (multi-vendor credit) -- that '
  'is intentional, not a bug. Populated only by the automatic matching '
  'function; never updated by it, only inserted with ON CONFLICT DO '
  'NOTHING, so re-running the matcher only adds newly-qualifying rows and '
  'never alters or removes what is already here. Independent of, and does '
  'not affect, the legacy sales.vendor_id/lead_id/attribution_status single '
  '-winner columns.';

ALTER TABLE public.sale_attributions ENABLE ROW LEVEL SECURITY;

-- Mirrors the sales/leads/vendors RLS pattern exactly, with one deliberate
-- difference: no client-facing INSERT/UPDATE policy for regular
-- authenticated users. Every write to this table happens through a
-- SECURITY DEFINER matching function (added in a later migration), which
-- runs with the privileges of its owner and bypasses RLS for its own
-- inserts -- so callers never need direct INSERT rights here. In practice
-- that makes this table read-only from the client's perspective except for
-- admins, who get a manual escape hatch (the "FOR ALL" policy below) to
-- delete a wrong row by hand. The automated matching logic itself never
-- issues UPDATE or DELETE, by construction -- see the matching function.
CREATE POLICY "Admins manage all sale attributions" ON public.sale_attributions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view own org sale attributions" ON public.sale_attributions
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));
