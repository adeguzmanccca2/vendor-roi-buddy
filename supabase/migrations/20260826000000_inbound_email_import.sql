-- Support inbound-email (Postmark) DMS export imports: a scheduled/automated email
-- with a CSV/Excel attachment lands on dms.autoadvisoragent.com, gets parsed by a
-- Vercel serverless function (/api/inbound-email/dms), and needs (a) a way to map the
-- sender's domain to an organization and (b) an audit trail of what was processed.

-- Sender domain -> org mapping, stored on the existing api_credentials row rather than
-- a hardcoded map in code, so a new dealership's export can be whitelisted with a SQL
-- update instead of a code deploy. Nullable: most credential rows won't use this path
-- (only ones tied to an inbound-email integration will have it set).
ALTER TABLE public.api_credentials
  ADD COLUMN IF NOT EXISTS sender_domain TEXT;

-- One domain should resolve to exactly one credential/org, but the same domain can't
-- be reused across two different rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_credentials_sender_domain
  ON public.api_credentials (lower(sender_domain))
  WHERE sender_domain IS NOT NULL;

-- Audit trail for every inbound-email import attempt (success, partial, or failed).
CREATE TABLE public.dms_import_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  filename          TEXT,
  sender_email      TEXT NOT NULL,
  rows_imported     INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  raw_errors        JSONB NOT NULL DEFAULT '[]'::jsonb,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'failed' CHECK (status IN ('success', 'partial', 'failed'))
);

ALTER TABLE public.dms_import_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_dms_import_logs_org ON public.dms_import_logs(organization_id, received_at DESC);

-- Written exclusively by the service-role Vercel function (bypasses RLS). These
-- policies only govern read access from the app / dashboard.
CREATE POLICY "Admins view all dms import logs"
  ON public.dms_import_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients view own org dms import logs"
  ON public.dms_import_logs FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org(auth.uid()));
