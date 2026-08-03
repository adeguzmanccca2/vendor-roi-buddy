export interface AttributionLeadLike {
  vendor_id?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  vin?: string | null;
  stock_number?: string | null;
}

export interface AttributionSaleLike {
  vendor_id?: string | null;
  normalized_email?: string | null;
  normalized_phone?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  vin?: string | null;
  stock_number?: string | null;
}

function normalizeText(value?: string | null): string {
  return (value ?? '').trim().toUpperCase();
}

function normalizeEmail(value?: string | null): string {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '');
}

export function buildVendorLookupMaps(leads: AttributionLeadLike[]) {
  const vinToVendors = new Map<string, Set<string>>();
  const stockToVendors = new Map<string, Set<string>>();
  const emailToVendors = new Map<string, Set<string>>();
  const phoneToVendors = new Map<string, Set<string>>();

  for (const lead of leads) {
    if (!lead.vendor_id) continue;

    if (lead.vin) {
      const key = normalizeText(lead.vin);
      if (key) {
        const set = vinToVendors.get(key) ?? new Set<string>();
        set.add(lead.vendor_id);
        vinToVendors.set(key, set);
      }
    }

    if (lead.stock_number) {
      const key = normalizeText(lead.stock_number);
      if (key) {
        const set = stockToVendors.get(key) ?? new Set<string>();
        set.add(lead.vendor_id);
        stockToVendors.set(key, set);
      }
    }

    if (lead.customer_email) {
      const key = normalizeEmail(lead.customer_email);
      if (key) {
        const set = emailToVendors.get(key) ?? new Set<string>();
        set.add(lead.vendor_id);
        emailToVendors.set(key, set);
      }
    }

    if (lead.customer_phone) {
      const key = normalizePhone(lead.customer_phone);
      if (key) {
        const set = phoneToVendors.get(key) ?? new Set<string>();
        set.add(lead.vendor_id);
        phoneToVendors.set(key, set);
      }
    }
  }

  return { vinToVendors, stockToVendors, emailToVendors, phoneToVendors };
}

export function getMatchingVendorIds({
  sale,
  knownVendorIds,
  leads,
  vinToVendors,
  stockToVendors,
  emailToVendors,
  phoneToVendors,
}: {
  sale: AttributionSaleLike;
  knownVendorIds: Set<string>;
  leads?: AttributionLeadLike[];
  vinToVendors?: Map<string, Set<string>>;
  stockToVendors?: Map<string, Set<string>>;
  emailToVendors?: Map<string, Set<string>>;
  phoneToVendors?: Map<string, Set<string>>;
}) {
  const lookup = leads ? buildVendorLookupMaps(leads) : { vinToVendors, stockToVendors, emailToVendors, phoneToVendors };
  const resolvedVinToVendors = lookup.vinToVendors;
  const resolvedStockToVendors = lookup.stockToVendors;
  const resolvedEmailToVendors = lookup.emailToVendors;
  const resolvedPhoneToVendors = lookup.phoneToVendors;
  if (sale.vendor_id && knownVendorIds.has(sale.vendor_id)) {
    return [sale.vendor_id];
  }

  const matches = new Set<string>();

  const vin = sale.vin ? normalizeText(sale.vin) : '';
  if (vin && resolvedVinToVendors?.get(vin)?.size) {
    for (const vendorId of resolvedVinToVendors.get(vin) ?? []) {
      matches.add(vendorId);
    }
    return Array.from(matches);
  }

  const stock = sale.stock_number ? normalizeText(sale.stock_number) : '';
  if (stock && resolvedStockToVendors?.get(stock)?.size) {
    for (const vendorId of resolvedStockToVendors.get(stock) ?? []) {
      matches.add(vendorId);
    }
    return Array.from(matches);
  }

  const email = sale.normalized_email ?? sale.customer_email ?? '';
  const emailKey = normalizeEmail(email);
  if (emailKey && resolvedEmailToVendors?.get(emailKey)?.size) {
    for (const vendorId of resolvedEmailToVendors.get(emailKey) ?? []) {
      matches.add(vendorId);
    }
    return Array.from(matches);
  }

  const phone = sale.normalized_phone ?? sale.customer_phone ?? '';
  const phoneKey = normalizePhone(phone);
  if (phoneKey && resolvedPhoneToVendors?.get(phoneKey)?.size) {
    for (const vendorId of resolvedPhoneToVendors.get(phoneKey) ?? []) {
      matches.add(vendorId);
    }
    return Array.from(matches);
  }

  return Array.from(matches);
}
