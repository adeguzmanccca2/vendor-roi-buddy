// Bulk "Lead Provider -> vendor" rules for the Source Rules page: paste two
// columns (straight from Excel, or comma-separated) and get one exact-match
// rule per line. Either column order works -- the side whose values are
// vendor names is the vendor side. A blank vendor (or "skip") makes a skip
// rule, e.g. "Service".

export interface BulkVendor { id: string; name: string }

export interface BulkRuleLine {
  line: number;
  provider: string;
  vendorText: string;
  // map: rule to a vendor; skip: skip rule; exists: a rule for this provider
  // is already there (left alone); error: can't be added.
  kind: 'map' | 'skip' | 'exists' | 'error';
  vendorId: string | null;
  error?: string;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function splitLine(raw: string): [string, string] {
  const parts = raw.includes('\t') ? raw.split('\t') : raw.split(',');
  return [(parts[0] ?? '').trim(), parts.slice(1).join(raw.includes('\t') ? '\t' : ',').trim()];
}

export function parseBulkRules(
  text: string,
  vendors: BulkVendor[],
  existingPatterns: string[] = [],
): { lines: BulkRuleLine[]; vendorFirst: boolean } {
  const vendorByKey = new Map(vendors.map(v => [key(v.name), v]));
  const isVendor = (s: string) => s !== '' && vendorByKey.has(key(s));
  const isSkip = (s: string) => s === '' || /^skip$/i.test(s);

  let cells = text.split(/\r?\n/)
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter(l => l.raw.trim() !== '')
    .map(l => ({ line: l.line, cells: splitLine(l.raw) }));

  // A header row (e.g. "Row Labels" from a pivot table, or "Vendor / Lead
  // Provider") names neither a vendor nor a provider -- drop it.
  const first = cells[0];
  if (first && !isVendor(first.cells[0]) && !isVendor(first.cells[1])
      && first.cells.some(c => /row labels|lead provider|provider|vendor|source/i.test(c))) {
    cells = cells.slice(1);
  }

  // Vendor column = the one with more vendor names in it.
  const leftHits = cells.filter(c => isVendor(c.cells[0])).length;
  const rightHits = cells.filter(c => isVendor(c.cells[1])).length;
  const vendorFirst = leftHits > rightHits;

  const existing = new Set(existingPatterns.map(p => p.trim().toLowerCase()));
  const seen = new Set<string>();
  const lines = cells.map(({ line, cells: [a, b] }): BulkRuleLine => {
    const provider = vendorFirst ? b : a;
    const vendorText = vendorFirst ? a : b;
    const base = { line, provider, vendorText, vendorId: null };
    if (!provider) return { ...base, kind: 'error', error: 'No Lead Provider value' };
    const pKey = provider.toLowerCase();
    if (seen.has(pKey)) return { ...base, kind: 'error', error: 'Listed twice' };
    seen.add(pKey);
    if (existing.has(pKey)) return { ...base, kind: 'exists' };
    if (isSkip(vendorText)) return { ...base, kind: 'skip' };
    const v = vendorByKey.get(key(vendorText));
    if (!v) return { ...base, kind: 'error', error: `No vendor named "${vendorText}"` };
    return { ...base, kind: 'map', vendorId: v.id };
  });

  return { lines, vendorFirst };
}
