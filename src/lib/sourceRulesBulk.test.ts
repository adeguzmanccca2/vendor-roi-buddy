import { describe, expect, it } from 'vitest';
import { parseBulkRules } from './sourceRulesBulk';

const vendors = [
  { id: 'cg', name: 'Car Gurus' },
  { id: 'dl', name: 'Dealer' },
  { id: 'fd', name: 'Ford' },
];

describe('parseBulkRules', () => {
  it('reads a pasted Excel pivot (vendor first, header row, blank vendor = skip)', () => {
    const text = '\tRow Labels\nCarGurus\tCarGurus\nDealer\tDealer Website\nFord\tFD - Pre-Owned\n\tService\nDealer\tWebsite\n';
    const { lines, vendorFirst } = parseBulkRules(text, vendors);
    expect(vendorFirst).toBe(true);
    expect(lines.map(l => [l.provider, l.kind, l.vendorId])).toEqual([
      ['CarGurus', 'map', 'cg'],
      ['Dealer Website', 'map', 'dl'],
      ['FD - Pre-Owned', 'map', 'fd'],
      ['Service', 'skip', null],
      ['Website', 'map', 'dl'],
    ]);
  });

  it('reads provider-first comma lines and "skip"', () => {
    const { lines, vendorFirst } = parseBulkRules('LVDS, Ford\nService, skip', vendors);
    expect(vendorFirst).toBe(false);
    expect(lines.map(l => [l.provider, l.kind])).toEqual([['LVDS', 'map'], ['Service', 'skip']]);
  });

  it('flags unknown vendors, repeats, and providers that already have a rule', () => {
    const { lines } = parseBulkRules('Drive By\tShowroom\nLVDS\tFord\nlvds\tFord\nWebsite\tDealer', vendors, ['Website']);
    expect(lines.map(l => [l.provider, l.kind, l.error])).toEqual([
      ['Drive By', 'error', 'No vendor named "Showroom"'],
      ['LVDS', 'map', undefined],
      ['lvds', 'error', 'Listed twice'],
      ['Website', 'exists', undefined],
    ]);
  });
});
