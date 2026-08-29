-- Add real dedup protection to the automated leads paths (receive-leads
-- webhook, inbound-email import) without touching the manual CSV-upload
-- page's richer client-side fingerprint review (Upload.tsx) — that page
-- never sets dedup_hash, so it's entirely unaffected by this: Postgres
-- already treats every NULL as distinct from every other NULL in a unique
-- index, same reasoning as idx_sales_dedup's fix in
-- 20260829000000_fix_sales_dedup_index.sql.
--
-- idx_leads_dedup was a plain (non-unique) index, so it could never be an
-- ON CONFLICT target for an upsert — same class of bug just fixed on sales.
DROP INDEX IF EXISTS public.idx_leads_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_dedup
  ON public.leads(organization_id, dedup_hash);
