
-- Sales table
CREATE TABLE public.sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  raw_upload_id UUID,

  customer_full_name TEXT,
  customer_first_name TEXT,
  customer_last_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  normalized_email TEXT,
  normalized_phone TEXT,

  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_of_interest TEXT,
  stock_number TEXT,
  deal_number TEXT,
  salesperson TEXT,

  sale_date TIMESTAMPTZ,
  gross_revenue NUMERIC(12,2) DEFAULT 0,
  front_gross NUMERIC(12,2) DEFAULT 0,
  back_gross NUMERIC(12,2) DEFAULT 0,
  total_gross NUMERIC(12,2) DEFAULT 0,

  attribution_status TEXT NOT NULL DEFAULT 'unmatched',
  attribution_confidence INTEGER DEFAULT 0,
  manual_override BOOLEAN NOT NULL DEFAULT false,
  dedup_hash TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_org ON public.sales(organization_id);
CREATE INDEX idx_sales_vendor ON public.sales(vendor_id);
CREATE INDEX idx_sales_lead ON public.sales(lead_id);
CREATE INDEX idx_sales_email ON public.sales(organization_id, normalized_email);
CREATE INDEX idx_sales_phone ON public.sales(organization_id, normalized_phone);
CREATE INDEX idx_sales_date ON public.sales(organization_id, sale_date);
CREATE UNIQUE INDEX idx_sales_dedup ON public.sales(organization_id, dedup_hash) WHERE dedup_hash IS NOT NULL;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all sales" ON public.sales FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Clients view own org sales" ON public.sales FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));
CREATE POLICY "Clients insert own org sales" ON public.sales FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org(auth.uid()));
CREATE POLICY "Clients update own org sales" ON public.sales FOR UPDATE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));
CREATE POLICY "Clients delete own org sales" ON public.sales FOR DELETE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Raw sales uploads
CREATE TABLE public.raw_sales_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  filename TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  attributed_count INTEGER NOT NULL DEFAULT 0,
  column_mapping JSONB,
  raw_rows JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.raw_sales_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all sales uploads" ON public.raw_sales_uploads FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Clients view own org sales uploads" ON public.raw_sales_uploads FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));
CREATE POLICY "Clients insert own org sales uploads" ON public.raw_sales_uploads FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org(auth.uid()) AND uploaded_by = auth.uid());

-- Attribution function: match unattributed sales to leads by normalized email/phone
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
  IF NOT (has_role(auth.uid(), 'admin') OR get_user_org(auth.uid()) = _org_id) THEN
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
