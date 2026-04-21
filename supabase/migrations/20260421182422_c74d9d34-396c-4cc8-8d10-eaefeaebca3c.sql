
-- VENDORS
CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vendor_type TEXT,
  monthly_cost NUMERIC(12,2) DEFAULT 0,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendors_org ON public.vendors(organization_id);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all vendors" ON public.vendors
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view own org vendors" ON public.vendors
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients insert own org vendors" ON public.vendors
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients update own org vendors" ON public.vendors
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients delete own org vendors" ON public.vendors
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE TRIGGER update_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- LEADS
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  raw_upload_id UUID,

  -- raw display fields
  customer_first_name TEXT,
  customer_last_name TEXT,
  customer_full_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,

  -- normalized for matching/dedup
  normalized_email TEXT,
  normalized_phone TEXT,
  dedup_hash TEXT,

  vehicle_of_interest TEXT,
  vehicle_year INT,
  vehicle_make TEXT,
  vehicle_model TEXT,

  lead_date TIMESTAMPTZ,
  lead_status TEXT NOT NULL DEFAULT 'new',
  source_label TEXT,
  notes TEXT,
  manual_override BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_org ON public.leads(organization_id);
CREATE INDEX idx_leads_vendor ON public.leads(vendor_id);
CREATE INDEX idx_leads_dedup ON public.leads(organization_id, dedup_hash);
CREATE INDEX idx_leads_norm_email ON public.leads(organization_id, normalized_email);
CREATE INDEX idx_leads_norm_phone ON public.leads(organization_id, normalized_phone);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all leads" ON public.leads
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view own org leads" ON public.leads
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients insert own org leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients update own org leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients delete own org leads" ON public.leads
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RAW LEAD UPLOADS (audit)
CREATE TABLE public.raw_lead_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  uploaded_by UUID NOT NULL,
  filename TEXT,
  row_count INT NOT NULL DEFAULT 0,
  inserted_count INT NOT NULL DEFAULT 0,
  duplicate_count INT NOT NULL DEFAULT 0,
  column_mapping JSONB,
  raw_rows JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_raw_uploads_org ON public.raw_lead_uploads(organization_id);

ALTER TABLE public.raw_lead_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all uploads" ON public.raw_lead_uploads
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view own org uploads" ON public.raw_lead_uploads
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients insert own org uploads" ON public.raw_lead_uploads
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org(auth.uid()) AND uploaded_by = auth.uid());
