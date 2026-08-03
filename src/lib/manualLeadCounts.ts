export interface ManualLeadCountBreakdown {
  parts: number;
  service: number;
}

export function resolveLeadCount({
  vendorId,
  manualLeadCounts,
  fallbackLeadCount,
}: {
  vendorId: string;
  manualLeadCounts: Record<string, ManualLeadCountBreakdown>;
  fallbackLeadCount: number;
}) {
  const manual = manualLeadCounts[vendorId];
  const manualTotal = manual ? Number(manual.parts ?? 0) + Number(manual.service ?? 0) : 0;

  // Manual parts/service leads (walk-ins, phone-ups, etc.) aren't in the
  // imported leads table — they're additional to it, not a replacement.
  return Number(fallbackLeadCount ?? 0) + manualTotal;
}

export function resolveLeadTotal({
  manualLeadCounts,
  vendorIds,
  fallbackCountsByVendor,
  fallbackUnassignedCount = 0,
}: {
  manualLeadCounts: Record<string, ManualLeadCountBreakdown>;
  vendorIds: string[];
  fallbackCountsByVendor: Record<string, number>;
  fallbackUnassignedCount?: number;
}) {
  let total = Number(fallbackUnassignedCount ?? 0);

  for (const vendorId of vendorIds) {
    total += resolveLeadCount({
      vendorId,
      manualLeadCounts,
      fallbackLeadCount: Number(fallbackCountsByVendor[vendorId] ?? 0),
    });
  }

  return total;
}
