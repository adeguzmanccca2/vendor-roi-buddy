import { describe, expect, it } from 'vitest';
import { applySavedCrmMapping, crmRowsFromFile, existingLeadWindow, guessCrmMapping, isCrmFile, resolveCrmMapping, planCrmImport, resolveProvider, type CrmLeadRow, type ExistingLead, type SourceRule } from './crmLeads';

const rules: SourceRule[] = [
  { pattern: 'CarGurus', match_type: 'exact', priority: 100, is_active: true, vendor_id: 'cargurus' },
  { pattern: 'FD - Pre-Owned', match_type: 'exact', priority: 100, is_active: true, vendor_id: 'ford' },
  { pattern: 'facebook', match_type: 'contains', priority: 100, is_active: true, vendor_id: 'shiftly' },
  { pattern: 'Service', match_type: 'exact', priority: 100, is_active: true, vendor_id: null },
  { pattern: 'Old', match_type: 'exact', priority: 100, is_active: false, vendor_id: 'old' },
];

let n = 1;
function row(over: Partial<CrmLeadRow>): CrmLeadRow {
  return {
    rowNumber: ++n, provider: 'CarGurus', firstName: null, lastName: null, fullName: 'Pat Doe',
    email: null, phone: null, vin: null, stock: null, vehicle: null,
    vehicleYear: null, vehicleMake: null, vehicleModel: null, vehicleTrim: null, vehicleCondition: null,
    leadDate: '2026-09-10T00:00:00.000Z', notes: null, ...over,
  };
}
function lead(over: Partial<ExistingLead>): ExistingLead {
  return {
    id: 'L1', vendor_id: 'cargurus', lead_date: '2026-09-10T15:00:00.000Z',
    customer_email: null, customer_phone: null, normalized_email: null, normalized_phone: null,
    vin: null, stock_number: null, customer_first_name: 'Pat', customer_last_name: 'Doe', customer_full_name: 'Pat Doe',
    vehicle_year: null, vehicle_make: null, vehicle_model: null, vehicle_trim: null, vehicle_of_interest: null, ...over,
  };
}

describe('resolveProvider', () => {
  it('maps exact and contains rules case-insensitively', () => {
    expect(resolveProvider(' cargurus ', rules)).toEqual({ kind: 'vendor', vendorId: 'cargurus' });
    expect(resolveProvider('HDMC-Facebook', rules)).toEqual({ kind: 'vendor', vendorId: 'shiftly' });
  });
  it('treats a rule without a vendor as skip, and ignores inactive rules', () => {
    expect(resolveProvider('Service', rules)).toEqual({ kind: 'skip' });
    expect(resolveProvider('Old', rules)).toEqual({ kind: 'unmapped' });
    expect(resolveProvider('Walk-in', rules)).toEqual({ kind: 'unmapped' });
  });
  it('prefers the lower priority number, then exact over contains', () => {
    const r: SourceRule[] = [
      { pattern: 'face', match_type: 'contains', priority: 100, is_active: true, vendor_id: 'a' },
      { pattern: 'facebook', match_type: 'exact', priority: 100, is_active: true, vendor_id: 'b' },
      { pattern: 'book', match_type: 'contains', priority: 50, is_active: true, vendor_id: 'c' },
    ];
    expect(resolveProvider('facebook', r)).toEqual({ kind: 'vendor', vendorId: 'c' });
    expect(resolveProvider('facebook', r.slice(0, 2))).toEqual({ kind: 'vendor', vendorId: 'b' });
  });
});

describe('planCrmImport', () => {
  it('matches the same person for the same vendor and fills blanks', () => {
    const existing = [lead({ customer_phone: '(555) 123-4567', normalized_phone: '5551234567' })];
    const plan = planCrmImport([row({ phone: '555-123-4567', email: 'Pat@Example.com', vin: '1FT123' })], existing, rules);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.enrichments).toHaveLength(1);
    expect(plan.enrichments[0].leadId).toBe('L1');
    // Phone already there; email and VIN were blank, so they're filled.
    expect(plan.enrichments[0].patch).toEqual({ customer_email: 'Pat@Example.com', normalized_email: 'pat@example.com', vin: '1FT123' });
  });

  it('inserts when the match is older than 30 days, or for a different vendor', () => {
    const existing = [lead({ normalized_email: 'pat@example.com', lead_date: '2026-07-01T00:00:00.000Z' })];
    expect(planCrmImport([row({ email: 'pat@example.com' })], existing, rules).inserts).toHaveLength(1);
    const sameDate = [lead({ normalized_email: 'pat@example.com', vendor_id: 'ford' })];
    expect(planCrmImport([row({ email: 'pat@example.com' })], sameDate, rules).inserts).toHaveLength(1);
  });

  it('does not merge two different shoppers who share a VIN', () => {
    const existing = [lead({ vin: '1FT123', normalized_email: 'someone@else.com' })];
    const plan = planCrmImport([row({ vin: '1ft-123', email: 'pat@example.com' })], existing, rules);
    expect(plan.inserts).toHaveLength(1);
    // ...but a VIN match with no conflicting contact info is the same lead.
    const plan2 = planCrmImport([row({ vin: '1ft-123' })], existing, rules);
    expect(plan2.enrichments).toHaveLength(1);
  });

  it('skips Service rows and rows with nothing to identify them', () => {
    const plan = planCrmImport([
      row({ provider: 'Service', email: 'a@b.com' }),
      row({ fullName: null }),
    ], [], rules);
    expect(plan.skips.map(s => s.reason)).toEqual(['skip-rule', 'no-identifier']);
  });

  it('imports unknown providers as Unassigned and reports them', () => {
    const plan = planCrmImport([row({ provider: 'Walk-in', phone: '5550001111' })], [], rules);
    expect(plan.inserts[0].vendorId).toBeNull();
    expect(plan.unmappedProviders.get('Walk-in')).toBe(1);
  });

  it('collapses the same person listed twice in one file into one new lead', () => {
    const plan = planCrmImport([
      row({ phone: '5550001111' }),
      row({ phone: '555-000-1111', email: 'pat@example.com', leadDate: '2026-09-15T00:00:00.000Z' }),
    ], [], rules);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].fields.customer_email).toBe('pat@example.com');
    expect(plan.skips.map(s => s.reason)).toEqual(['duplicate-in-file']);
    expect(plan.skips[0].mergedIntoRow).toBe(plan.inserts[0].row.rowNumber);
  });

  it('tallies each Lead Provider for the preview', () => {
    const existing = [lead({ normalized_phone: '5551234567' })];
    const plan = planCrmImport([
      row({ phone: '5551234567' }),
      row({ phone: '5559999999' }),
      row({ provider: 'Service', phone: '5558888888' }),
    ], existing, rules);
    expect(plan.byProvider.get('CarGurus')).toMatchObject({ rows: 2, inserts: 1, matched: 1, skipped: 0 });
    expect(plan.byProvider.get('Service')).toMatchObject({ rows: 1, skipped: 1 });
  });
});

describe('existingLeadWindow', () => {
  it("is the file's own date range, whole days", () => {
    const w = existingLeadWindow([row({ leadDate: '2026-09-01T04:00:00.000Z' }), row({ leadDate: '2026-09-30T04:00:00.000Z' })]);
    expect(w).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' });
    expect(existingLeadWindow([row({ leadDate: null })])).toBeNull();
  });

  it('only matches existing leads dated inside that range', () => {
    const rows = [
      row({ email: 'pat@example.com', leadDate: '2026-09-03T04:00:00.000Z' }),
      row({ phone: '5550001111', leadDate: '2026-09-30T04:00:00.000Z' }),
    ];
    const existing = [
      lead({ id: 'AUG', normalized_email: 'pat@example.com', lead_date: '2026-08-28T04:00:00.000Z' }), // before the file
      lead({ id: 'SEP', normalized_phone: '5550001111', lead_date: '2026-09-25T04:00:00.000Z' }),
      lead({ id: 'NODATE', normalized_email: 'pat@example.com', lead_date: null }),
    ];
    const plan = planCrmImport(rows, existing, rules);
    expect(plan.enrichments.map(e => e.leadId)).toEqual(['SEP']);
    expect(plan.inserts).toHaveLength(1); // the Aug 28 / undated person becomes a new September lead
  });
});

describe('eLead CRM export columns', () => {
  // Header row of Bayshore Ford's eLead export; values below are made up.
  const headers = ['First Name', 'Last Name', 'Address1', 'Address2', 'City', 'State', 'Zip', 'Dealership Name',
    'Dealership Address1', 'Dealership Address2', 'Dealership City', 'Dealership State', 'Dealership Zip',
    'Dealership Phone #', 'Dealership FAX', 'Sales Person', 'Home Phone', 'Work Phone', 'Cell Phone', 'DoNotEmail',
    'Email', 'Elead ID', 'Source Type', 'Lead Provider', 'Date In', 'Wanted Veh Make', 'Wanted Veh Model',
    'Wanted Veh Trim', 'Wanted Veh Year', 'New/Used'];

  it('is recognized as a CRM file and maps the right columns', () => {
    expect(isCrmFile(headers)).toBe(true);
    expect(guessCrmMapping(headers)).toEqual({
      provider: 'Lead Provider', lead_date: 'Date In', first_name: 'First Name', last_name: 'Last Name',
      email: 'Email', phone: 'Cell Phone', home_phone: 'Home Phone', work_phone: 'Work Phone',
      vehicle_year: 'Wanted Veh Year', vehicle_make: 'Wanted Veh Make', vehicle_model: 'Wanted Veh Model',
      vehicle_trim: 'Wanted Veh Trim', new_used: 'New/Used',
    });
  });

  it('builds lead rows: date, phone fallback, vehicle columns, business names', () => {
    const blank = Object.fromEntries(headers.map(h => [h, '']));
    const [a, b] = crmRowsFromFile([
      { ...blank, 'Last Name': 'Acme Plumbing LLC', 'Home Phone': '813-555-0100', 'Lead Provider': 'Drive By',
        'Date In': '9/16/26', 'Wanted Veh Year': '2015-2027 and Older', 'Wanted Veh Make': 'Ford', 'Wanted Veh Model': 'F-150' },
      { ...blank, 'First Name': 'Pat', 'Last Name': 'Doe', 'Cell Phone': '813-555-0199', 'Home Phone': '813-555-0100',
        'Lead Provider': 'CarGurus', 'Date In': '9/9/26', 'Wanted Veh Year': '2025' },
    ], guessCrmMapping(headers));
    expect(new Date(a.leadDate!).getFullYear()).toBe(2026);
    expect(a.phone).toBe('813-555-0100');
    expect(b.phone).toBe('813-555-0199');

    const plan = planCrmImport([a, b], [], rules);
    const acme = plan.inserts.find(i => i.row === a)!.fields;
    expect(acme.customer_full_name).toBe('Acme Plumbing LLC');
    expect(acme.vehicle_year).toBeNull(); // a year range isn't a year
    expect(acme.vehicle_make).toBe('Ford');
    expect(acme.vehicle_of_interest).toBe('Ford F-150');
    expect(plan.inserts.find(i => i.row === b)!.fields.vehicle_year).toBe(2025);
  });
});

describe('saved CRM column mapping', () => {
  // A different CRM's export: no "Lead Provider" column, other names throughout.
  const headers = ['Customer', 'Mobile', 'E-Mail Address', 'Lead Source', 'Created On'];
  const saved = { provider: 'lead source', phone: 'Mobile', email: 'E-Mail Address', lead_date: 'Created On', full_name: 'Customer', vin: 'VIN' };

  it('applies a saved mapping case-insensitively and drops columns the file lacks', () => {
    expect(applySavedCrmMapping(headers, saved)).toEqual({
      provider: 'Lead Source', phone: 'Mobile', email: 'E-Mail Address', lead_date: 'Created On', full_name: 'Customer',
    });
  });

  it('does not apply when the file has no saved provider column', () => {
    expect(applySavedCrmMapping(['Name', 'Phone'], saved)).toBeNull();
    expect(applySavedCrmMapping(headers, null)).toBeNull();
  });

  it('recognizes a CRM file by its saved mapping, falling back to guesses', () => {
    expect(isCrmFile(headers)).toBe(false);
    expect(isCrmFile(headers, saved)).toBe(true);
    expect(resolveCrmMapping(headers, saved).fromSaved).toBe(true);
    const guessed = resolveCrmMapping(['Lead Provider', 'Email'], saved);
    expect(guessed).toEqual({ mapping: { provider: 'Lead Provider', email: 'Email' }, fromSaved: false });
  });
});

describe('different wanted vehicle = separate inquiry', () => {
  const pat = { phone: '5550001111', vehicleMake: 'Ford', vehicleModel: 'F-150' };

  it('keeps one person with two vehicles as two leads, but merges exact repeats', () => {
    const plan = planCrmImport([
      row({ ...pat, vehicleTrim: 'XLT' }),
      row({ ...pat, vehicleTrim: 'Lariat' }),     // same eLead lead, other trim -> separate
      row({ ...pat, vehicleTrim: 'XLT' }),        // exact repeat -> merged
      row({ ...pat, vehicleModel: 'Ranger', vehicleTrim: null, vehicleCondition: 'Used' }),
    ], [], rules);
    expect(plan.inserts).toHaveLength(3);
    expect(plan.skips.map(s => s.reason)).toEqual(['duplicate-in-file']);
  });

  it('lets a vendor lead match only one of the vehicles; the next is a new lead', () => {
    const existing = [lead({ normalized_phone: '5550001111' })];
    const plan = planCrmImport([
      row({ ...pat, vehicleTrim: 'XLT' }),
      row({ ...pat, vehicleTrim: 'XLT', email: 'pat@example.com' }), // same vehicle -> same lead
      row({ ...pat, vehicleTrim: 'Lariat' }),
    ], existing, rules);
    expect(plan.enrichments).toHaveLength(1);
    expect(plan.byProvider.get('CarGurus')).toMatchObject({ matched: 2, inserts: 1 });
  });

  it('treats different VINs as different inquiries', () => {
    const existing = [lead({ normalized_phone: '5550001111', vin: '1FTAAA' })];
    const plan = planCrmImport([row({ phone: '5550001111', vin: '1FTBBB' })], existing, rules);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.enrichments).toHaveLength(0);
  });
});
