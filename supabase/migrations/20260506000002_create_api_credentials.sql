-- API credentials table for external CRM integrations

CREATE TABLE public.api_credentials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  provider         TEXT NOT NULL DEFAULT 'generic',
  api_key          TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_used_at     TIMESTAMPTZ,
  lead_count       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.api_credentials ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_api_credentials_org ON public.api_credentials(organization_id);
CREATE INDEX idx_api_credentials_key ON public.api_credentials(api_key);

CREATE POLICY "Admins manage all api credentials"
  ON public.api_credentials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients manage own org api credentials"
  ON public.api_credentials FOR ALL TO authenticated
  USING (organization_id = public.get_user_org(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org(auth.uid()));

CREATE TRIGGER set_api_credentials_updated_at
  BEFORE UPDATE ON public.api_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
