-- Per-dealership, per-month "average gross per vehicle" used by the
-- Attribution page to estimate Gross Revenue (sales x avg gross for the
-- month each sale closed). A month with no row falls back to the app's
-- default ($4,000), so only months someone has edited are stored.
--
-- `month` is always the first day of the month; the CHECK keeps a stray
-- mid-month date from creating a second row for the same month.
--
-- Idempotent: safe to re-run from the SQL editor.
CREATE TABLE IF NOT EXISTS public.avg_gross_per_vehicle (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (month = date_trunc('month', month)::date),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, month)
);

ALTER TABLE public.avg_gross_per_vehicle ENABLE ROW LEVEL SECURITY;

-- Same membership-aware predicate as the core tables (20260917000000).
DROP POLICY IF EXISTS "Members view their orgs avg gross"   ON public.avg_gross_per_vehicle;
DROP POLICY IF EXISTS "Members insert their orgs avg gross" ON public.avg_gross_per_vehicle;
DROP POLICY IF EXISTS "Members update their orgs avg gross" ON public.avg_gross_per_vehicle;
DROP POLICY IF EXISTS "Members delete their orgs avg gross" ON public.avg_gross_per_vehicle;

CREATE POLICY "Members view their orgs avg gross" ON public.avg_gross_per_vehicle
  FOR SELECT TO authenticated
  USING (public.user_can_access_org(organization_id));

CREATE POLICY "Members insert their orgs avg gross" ON public.avg_gross_per_vehicle
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_org(organization_id));

CREATE POLICY "Members update their orgs avg gross" ON public.avg_gross_per_vehicle
  FOR UPDATE TO authenticated
  USING (public.user_can_access_org(organization_id))
  WITH CHECK (public.user_can_access_org(organization_id));

CREATE POLICY "Members delete their orgs avg gross" ON public.avg_gross_per_vehicle
  FOR DELETE TO authenticated
  USING (public.user_can_access_org(organization_id));
