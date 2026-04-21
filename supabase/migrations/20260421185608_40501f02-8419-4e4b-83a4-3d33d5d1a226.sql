-- ============================================================
-- Phase 5: Source mapping rules + Vendor inventory
-- ============================================================

-- 1. SOURCE MAPPING RULES --------------------------------------
CREATE TABLE public.source_mapping_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains', -- 'exact' | 'contains'
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_rules_org ON public.source_mapping_rules(organization_id, is_active, priority);

ALTER TABLE public.source_mapping_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all source rules"
  ON public.source_mapping_rules FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view own org source rules"
  ON public.source_mapping_rules FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients insert own org source rules"
  ON public.source_mapping_rules FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients update own org source rules"
  ON public.source_mapping_rules FOR UPDATE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients delete own org source rules"
  ON public.source_mapping_rules FOR DELETE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE TRIGGER update_source_rules_updated_at
  BEFORE UPDATE ON public.source_mapping_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. VENDOR INVENTORY ------------------------------------------
CREATE TABLE public.vendor_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  raw_upload_id UUID,
  vin TEXT,
  stock_number TEXT,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_trim TEXT,
  mileage INTEGER,
  price NUMERIC,
  status TEXT NOT NULL DEFAULT 'active', -- active | sold | removed
  listed_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_org_vendor ON public.vendor_inventory(organization_id, vendor_id);
CREATE INDEX idx_inventory_vin ON public.vendor_inventory(vin);
CREATE INDEX idx_inventory_stock ON public.vendor_inventory(stock_number);

ALTER TABLE public.vendor_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all inventory"
  ON public.vendor_inventory FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view own org inventory"
  ON public.vendor_inventory FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients insert own org inventory"
  ON public.vendor_inventory FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients update own org inventory"
  ON public.vendor_inventory FOR UPDATE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients delete own org inventory"
  ON public.vendor_inventory FOR DELETE TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE TRIGGER update_inventory_updated_at
  BEFORE UPDATE ON public.vendor_inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. RAW INVENTORY UPLOADS -------------------------------------
CREATE TABLE public.raw_inventory_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  filename TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  column_mapping JSONB,
  raw_rows JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.raw_inventory_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all inventory uploads"
  ON public.raw_inventory_uploads FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view own org inventory uploads"
  ON public.raw_inventory_uploads FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Clients insert own org inventory uploads"
  ON public.raw_inventory_uploads FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org(auth.uid()) AND uploaded_by = auth.uid());

-- 4. APPLY SOURCE MAPPING FUNCTION ------------------------------
CREATE OR REPLACE FUNCTION public.apply_source_mapping_for_org(_org_id uuid)
RETURNS TABLE(updated_count integer, total_unmapped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  upd INTEGER := 0;
  total INTEGER := 0;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin') OR get_user_org(auth.uid()) = _org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', _org_id;
  END IF;

  SELECT COUNT(*) INTO total FROM public.leads
   WHERE organization_id = _org_id
     AND vendor_id IS NULL
     AND source_label IS NOT NULL
     AND manual_override = false;

  WITH rule_matches AS (
    SELECT DISTINCT ON (l.id)
      l.id AS lead_id, r.vendor_id
    FROM public.leads l
    JOIN public.source_mapping_rules r
      ON r.organization_id = l.organization_id
     AND r.is_active = true
     AND (
       (r.match_type = 'exact'    AND lower(l.source_label) = lower(r.pattern))
       OR
       (r.match_type = 'contains' AND lower(l.source_label) LIKE '%' || lower(r.pattern) || '%')
     )
    WHERE l.organization_id = _org_id
      AND l.vendor_id IS NULL
      AND l.source_label IS NOT NULL
      AND l.manual_override = false
    ORDER BY l.id, r.priority ASC
  )
  UPDATE public.leads l
     SET vendor_id = rm.vendor_id
    FROM rule_matches rm
   WHERE l.id = rm.lead_id;
  GET DIAGNOSTICS upd = ROW_COUNT;

  RETURN QUERY SELECT upd, total;
END;
$$;