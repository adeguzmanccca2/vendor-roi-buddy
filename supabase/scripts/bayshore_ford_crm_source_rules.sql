-- Bayshore Ford: CRM "Lead Provider" -> vendor rules (exact match).
-- Run AFTER migration 20261009000000_crm_lead_import.sql and AFTER the
-- vendors Showroom, Shiftly, Ford and Existing exist for Bayshore Ford.
-- Vendor names are matched ignoring case and spaces ("Car Gurus" = "CarGurus").
-- Stops with an error, inserting nothing, if the org or any vendor is missing.
-- Re-runnable: an existing rule with the same pattern is left alone.
DO $$
DECLARE
  org uuid;
  m record;
  v uuid;
BEGIN
  IF (SELECT count(*) FROM public.organizations WHERE name ILIKE 'Bayshore Ford%') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one organization named like "Bayshore Ford" -- set org to its id by hand';
  END IF;
  SELECT id INTO org FROM public.organizations WHERE name ILIKE 'Bayshore Ford%';

  FOR m IN SELECT * FROM (VALUES
    ('CarGurus',                 'CarGurus'),
    ('Dealer Website',           'Dealer'),
    ('Drive By',                 'Showroom'),
    ('facebook his',             'Shiftly'),
    ('FD - DealerConnection',    'Ford'),
    ('FD - Fully Managed Chat',  'Podium'),
    ('FD - Pre-Owned',           'Ford'),
    ('Ford Blue Advantage',      'Ford'),
    ('Ford Credit',              'Ford'),
    ('FordPro',                  'Ford'),
    ('HDMC-Facebook',            'Shiftly'),
    ('LVDS',                     'Ford'),
    ('Perfect Prospect',         'Existing'),
    ('Previous Buyer',           'Existing'),
    ('Referral',                 'Existing'),
    ('Repeat',                   'Existing'),
    ('Service',                  NULL),        -- skip: not imported
    ('Social Up',                'Shiftly'),
    ('Website',                  'Dealer'),
    ('Work Truck Solutions',     'Work Truck Solutions')
  ) AS t(pattern, vendor_name)
  LOOP
    v := NULL;
    IF m.vendor_name IS NOT NULL THEN
      SELECT id INTO v FROM public.vendors
       WHERE organization_id = org
         AND lower(replace(name, ' ', '')) = lower(replace(m.vendor_name, ' ', ''));
      IF v IS NULL THEN
        RAISE EXCEPTION 'Vendor "%" not found for Bayshore Ford (needed for "%")', m.vendor_name, m.pattern;
      END IF;
    END IF;

    INSERT INTO public.source_mapping_rules (organization_id, vendor_id, pattern, match_type, priority, is_active, notes)
    SELECT org, v, m.pattern, 'exact', 100, true, 'CRM Lead Provider'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.source_mapping_rules
        WHERE organization_id = org AND lower(pattern) = lower(m.pattern)
     );
  END LOOP;
END $$;
