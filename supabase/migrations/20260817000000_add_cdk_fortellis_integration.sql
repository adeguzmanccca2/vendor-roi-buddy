-- CDK/Fortellis (Elead CRM) lead-pull integration.
-- One credential set per dealership; the edge function uses it to call
-- Fortellis's CRM Sales Opportunities API (GET /search, dateFrom/dateTo)
-- and upsert leads for a user-chosen date range.

CREATE TABLE public.cdk_fortellis_credentials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  client_id        TEXT NOT NULL,
  client_secret    TEXT NOT NULL,
  subscription_id  TEXT NOT NULL,
  -- Fortellis OAuth2 token endpoint for this app's client-credentials flow.
  -- Not standardized across Fortellis apps -- copy it from the app's
  -- Authorization tab on the Fortellis Developer Network.
  token_url        TEXT,
  -- Department-Id for the CDK Drive Post Customer v1 API (must resolve to
  -- an Accounting-type department in the DMS). Used to enrich pulled
  -- opportunities with the customer's name/email/phone.
  department_id    TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_synced_at   TIMESTAMPTZ,
  last_sync_status TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cdk_fortellis_credentials_org ON public.cdk_fortellis_credentials(organization_id);

ALTER TABLE public.cdk_fortellis_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all cdk fortellis credentials"
  ON public.cdk_fortellis_credentials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients manage own org cdk fortellis credentials"
  ON public.cdk_fortellis_credentials FOR ALL TO authenticated
  USING (organization_id = public.get_user_org(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org(auth.uid()));

CREATE TRIGGER set_cdk_fortellis_credentials_updated_at
  BEFORE UPDATE ON public.cdk_fortellis_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lets the sync function dedupe re-pulled leads against CDK's opportunity id
-- when the same date range is pulled more than once.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cdk_opportunity_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_cdk_opportunity_unique
  ON public.leads(organization_id, cdk_opportunity_id)
  WHERE cdk_opportunity_id IS NOT NULL;
