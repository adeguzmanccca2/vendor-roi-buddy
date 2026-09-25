import { describe, expect, it } from 'vitest';
import {
  buildDedupHash,
  guessColumn,
  looksNonHuman,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeRevenue,
  parseVehicle,
  splitName,
} from './normalize';

// These helpers are the matching keys every lead/sale attribution is built on,
// so a silent regression here shows up as a vendor being credited for the wrong
// sale rather than as an obvious crash.

describe('normalizePhone', () => {
  it('reduces common formatting to bare digits', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
    expect(normalizePhone('555.123.4567')).toBe('5551234567');
    expect(normalizePhone('555 123 4567')).toBe('5551234567');
  });

  it('strips a leading US country code', () => {
    expect(normalizePhone('1-555-123-4567')).toBe('5551234567');
    expect(normalizePhone('+1 (555) 123-4567')).toBe('5551234567');
  });

  it('agrees across formats so the same number matches itself', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe(normalizePhone('5551234567'));
  });

  it('rejects values too short to be a phone number', () => {
    expect(normalizePhone('123456')).toBeNull();
    expect(normalizePhone('ext. 42')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  John.Doe@Example.COM ')).toBe('john.doe@example.com');
  });

  it('rejects values that are not email-shaped', () => {
    expect(normalizeEmail('notanemail')).toBeNull();
    expect(normalizeEmail('missing@domain')).toBeNull();
    expect(normalizeEmail('two words@example.com')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });
});

describe('normalizeName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeName('  John   Doe ')).toBe('john doe');
  });

  it('returns an empty string rather than null', () => {
    expect(normalizeName(null)).toBe('');
  });
});

describe('splitName', () => {
  it('splits on the first space, keeping the rest as the surname', () => {
    expect(splitName('John Doe')).toEqual({ first: 'John', last: 'Doe' });
    expect(splitName('Mary Jo Van Der Berg')).toEqual({
      first: 'Mary',
      last: 'Jo Van Der Berg',
    });
  });

  it('leaves last null when only one token is present', () => {
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: null });
  });

  it('returns nulls for empty input', () => {
    expect(splitName(null)).toEqual({ first: null, last: null });
  });
});

describe('normalizeRevenue', () => {
  it('strips currency symbols and thousands separators', () => {
    expect(normalizeRevenue('$25,000.50')).toBe(25000.5);
    expect(normalizeRevenue('1,234')).toBe(1234);
  });

  it('treats parentheses and a minus sign as negative', () => {
    expect(normalizeRevenue('(1,200)')).toBe(-1200);
    expect(normalizeRevenue('-500')).toBe(-500);
  });

  it('preserves zero rather than collapsing it to null', () => {
    expect(normalizeRevenue('0')).toBe(0);
  });

  it('returns null when there is no number present', () => {
    expect(normalizeRevenue('')).toBeNull();
    expect(normalizeRevenue(null)).toBeNull();
    expect(normalizeRevenue('n/a')).toBeNull();
  });
});

describe('parseVehicle', () => {
  it('pulls year, make and model out of a combined string', () => {
    expect(parseVehicle('2021 Honda Civic LX')).toEqual({
      year: 2021,
      make: 'Honda',
      model: 'Civic LX',
    });
  });

  it('finds the year wherever it appears', () => {
    expect(parseVehicle('Honda Civic 2019')).toEqual({
      year: 2019,
      make: 'Honda',
      model: 'Civic',
    });
  });

  it('handles a missing year', () => {
    expect(parseVehicle('Honda Civic')).toEqual({
      year: null,
      make: 'Honda',
      model: 'Civic',
    });
  });

  it('leaves model null when only a make is given', () => {
    expect(parseVehicle('Toyota')).toEqual({ year: null, make: 'Toyota', model: null });
  });

  it('returns nulls for empty input', () => {
    expect(parseVehicle('')).toEqual({ year: null, make: null, model: null });
    expect(parseVehicle(null)).toEqual({ year: null, make: null, model: null });
  });
});

describe('guessColumn', () => {
  it('prefers an exact header match', () => {
    expect(guessColumn(['Email', 'Phone'], ['email'])).toBe('Email');
  });

  it('is case-insensitive but returns the original header spelling', () => {
    expect(guessColumn(['EMAIL'], ['email'])).toBe('EMAIL');
  });

  it('falls back to a word inside a longer header', () => {
    expect(guessColumn(['Customer Email Address'], ['email'])).toBe('Customer Email Address');
  });

  it('will not match a candidate buried inside a larger word', () => {
    // The point of the word-boundary pass: "last" must not match "Blast".
    expect(guessColumn(['Blast Radius'], ['last'])).toBeNull();
  });

  it('tries candidates in order', () => {
    expect(guessColumn(['Phone', 'Cell'], ['cell', 'phone'])).toBe('Cell');
  });

  it('returns null when nothing matches', () => {
    expect(guessColumn(['Foo', 'Bar'], ['email'])).toBeNull();
  });
});

describe('looksNonHuman', () => {
  it('flags currency and bare numbers', () => {
    expect(looksNonHuman('$1,000')).toBe(true);
    expect(looksNonHuman('25000')).toBe(true);
    expect(looksNonHuman('1,234.56')).toBe(true);
    expect(looksNonHuman('-500')).toBe(true);
  });

  it('accepts real names', () => {
    expect(looksNonHuman('John Doe')).toBe(false);
    expect(looksNonHuman("O'Brien")).toBe(false);
  });

  it('treats empty input as human', () => {
    expect(looksNonHuman('')).toBe(false);
    expect(looksNonHuman(null)).toBe(false);
  });
});

describe('buildDedupHash', () => {
  const base = {
    email: 'john@example.com',
    phone: '5551234567',
    name: 'john doe',
    vehicle: '2021 Honda Civic',
  };

  it('is deterministic for identical input', async () => {
    expect(await buildDedupHash(base)).toBe(await buildDedupHash(base));
  });

  it('returns a 64-character hex digest', async () => {
    expect(await buildDedupHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any identifier changes', async () => {
    const original = await buildDedupHash(base);
    expect(await buildDedupHash({ ...base, email: 'jane@example.com' })).not.toBe(original);
    expect(await buildDedupHash({ ...base, phone: '5559999999' })).not.toBe(original);
    expect(await buildDedupHash({ ...base, vehicle: '2020 Honda Civic' })).not.toBe(original);
  });

  it('normalizes VIN and stock number casing and padding', async () => {
    const padded = await buildDedupHash({ ...base, vin: '  1hgbh41jxmn109186  ' });
    const clean = await buildDedupHash({ ...base, vin: '1HGBH41JXMN109186' });
    expect(padded).toBe(clean);
  });

  it('treats a null identifier the same as an absent one', async () => {
    const withNulls = await buildDedupHash({ ...base, vin: null, stock_number: null });
    const without = await buildDedupHash(base);
    expect(withNulls).toBe(without);
  });

  // KNOWN LIMITATION, pinned deliberately rather than fixed. Fields are joined
  // with a bare "|" and never escaped, so a value that itself contains a pipe
  // can collide with a different field split. In practice names, vehicles and
  // VINs do not contain pipes, so this has no effect on real imports.
  //
  // Do NOT "fix" this by escaping the delimiter without a backfill plan: the
  // hash is stored in sales.dedup_hash / leads.dedup_hash behind a unique
  // index, so changing the format invalidates every existing row and the next
  // import re-inserts the entire history as new records.
  it('does not escape the field delimiter (documented collision)', async () => {
    const a = await buildDedupHash({ ...base, name: 'john', vehicle: 'doe|2021 Honda Civic' });
    const b = await buildDedupHash({ ...base, name: 'john|doe', vehicle: '2021 Honda Civic' });
    expect(a).toBe(b);
  });
});
