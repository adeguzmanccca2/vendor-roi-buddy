/**
 * Normalization helpers for messy dealership lead data.
 * Goal: produce consistent matching keys without relying on VIN.
 */

export function normalizePhone(input?: string | null): string | null {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, '');
  if (!digits) return null;
  // Strip leading US country code
  const trimmed = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return trimmed.length >= 7 ? trimmed : null;
}

export function normalizeEmail(input?: string | null): string | null {
  if (!input) return null;
  const e = String(input).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function normalizeName(input?: string | null): string {
  if (!input) return '';
  return String(input).trim().toLowerCase().replace(/\s+/g, ' ');
}

export function splitName(full?: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function parseLeadDate(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  // try mm/dd/yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const [, mm, dd, yy] = m;
    const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
    const dt = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  return null;
}

export function parseVehicle(text?: string | null): { year: number | null; make: string | null; model: string | null } {
  if (!text) return { year: null, make: null, model: null };
  const s = String(text).trim();
  const yearMatch = s.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  const rest = yearMatch ? s.replace(yearMatch[0], '').trim() : s;
  const tokens = rest.split(/\s+/).filter(Boolean);
  const make = tokens[0] ?? null;
  const model = tokens.length > 1 ? tokens.slice(1).join(' ') : null;
  return { year, make, model };
}

/**
 * Deterministic dedup hash from normalized identifiers.
 * Phone OR email is sufficient; falls back to name+vehicle.
 */
export async function buildDedupHash(parts: {
  email: string | null;
  phone: string | null;
  name: string;
  vehicle: string;
}): Promise<string> {
  const key = [parts.email ?? '', parts.phone ?? '', parts.name, parts.vehicle].join('|');
  const buf = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Strip currency symbols / commas / parens, return number or null */
export function normalizeRevenue(input?: string | null): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const isNeg = /^\(.*\)$/.test(raw) || raw.includes('-');
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return isNeg ? -n : n;
}

/** Best-effort fuzzy column matcher for CSV headers */
export function guessColumn(headers: string[], candidates: string[]): string | null {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h === cand.toLowerCase());
    if (idx >= 0) return headers[idx];
  }
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h.includes(cand.toLowerCase()));
    if (idx >= 0) return headers[idx];
  }
  return null;
}
