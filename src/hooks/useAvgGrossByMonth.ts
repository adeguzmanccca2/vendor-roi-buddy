import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// YYYY-MM -> avg gross per vehicle for one dealership; only months someone
// has edited (the rest use DEFAULT_AVG_GROSS). A load failure -- e.g.
// migration 20260925000000 not applied yet -- just leaves it empty so the
// page falls back to the default instead of breaking.
export function useAvgGrossByMonth(orgId: string | null) {
  const [byMonth, setByMonth] = useState<Record<string, number>>({});

  useEffect(() => {
    setByMonth({});
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      // Untyped client: the table isn't in the generated types.ts yet.
      const { data, error } = await (supabase as unknown as SupabaseClient)
        .from('avg_gross_per_vehicle').select('month, amount')
        .eq('organization_id', orgId);
      if (cancelled) return;
      if (error) {
        console.warn('Avg gross per vehicle unavailable, using default', error.message);
        return;
      }
      const map: Record<string, number> = {};
      for (const r of (data ?? []) as { month: string; amount: number | string }[]) {
        map[r.month.slice(0, 7)] = Number(r.amount);
      }
      setByMonth(map);
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  return [byMonth, setByMonth] as const;
}
