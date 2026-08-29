-- Fix ON CONFLICT (organization_id, dedup_hash) failing on receive-sales /
-- inbound-email upserts with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification".
--
-- idx_sales_dedup was created as a PARTIAL unique index
-- (WHERE dedup_hash IS NOT NULL) back when only the manual CSV-upload path
-- existed, which never sets dedup_hash (it dedupes in JS instead). Postgres
-- can only use a partial index as an ON CONFLICT target if the conflict
-- clause repeats the same WHERE predicate, which supabase-js's .upsert()
-- onConflict option has no way to express. Rebuilding it as a plain
-- (non-partial) unique index fixes this. This is safe for the manual-upload
-- path: Postgres already treats every NULL as distinct from every other
-- NULL in a unique index, so rows with dedup_hash = NULL still never
-- conflict with each other regardless of the WHERE clause.
DROP INDEX IF EXISTS public.idx_sales_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_dedup
  ON public.sales(organization_id, dedup_hash);
