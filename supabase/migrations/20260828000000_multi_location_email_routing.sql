-- Support multiple dealership locations sharing one inbound-email domain
-- (e.g. Bayshore Ford + Bayshore Trucks both emailing from the same
-- domain, split into two organizations by a "location" column in the
-- attachment). Previously sender_domain -> exactly one org; now a domain
-- can resolve to several orgs, disambiguated per-row by location_label.

-- Drop the old domain-only uniqueness (one domain could only ever map to
-- one credential/org).
DROP INDEX IF EXISTS public.idx_api_credentials_sender_domain;

-- Non-unique lookup index — a domain can now have multiple rows.
CREATE INDEX IF NOT EXISTS idx_api_credentials_sender_domain
  ON public.api_credentials (lower(sender_domain))
  WHERE sender_domain IS NOT NULL;

-- The location name this credential/org represents within a shared
-- inbound domain (e.g. 'Bayshore Ford', 'Bayshore Trucks'). Nullable:
-- single-location dealers using the email path don't need this set —
-- the import code falls back to the old "one domain, one org" behavior
-- when a domain has exactly one credential row.
ALTER TABLE public.api_credentials
  ADD COLUMN IF NOT EXISTS location_label TEXT;

-- Within a given domain, each location must be unique (and a location
-- label doesn't make sense without a domain to scope it to).
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_credentials_domain_location
  ON public.api_credentials (lower(sender_domain), lower(location_label))
  WHERE sender_domain IS NOT NULL AND location_label IS NOT NULL;
