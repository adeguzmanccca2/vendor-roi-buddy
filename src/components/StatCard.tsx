import type { ReactNode } from 'react';
import { Info, LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Compact KPI tile used across the Attribution page and the client dashboard.
 *
 * Extracted because both pages had a byte-identical copy of this and were
 * drifting apart every time one got restyled -- the same duplication problem
 * the attribution matchers already had.
 *
 * `sub` deliberately shares the value's baseline rather than taking its own
 * line: the three-line layout was what made these tiles tall, and no amount
 * of type/padding tightening halved the height without dropping that line.
 */
/**
 * Warm gradient steps, meant to be used left-to-right across a row of tiles
 * so the group reads as one progression rather than four unrelated colors.
 * Each has a darker pair for dark mode so a filled tile does not glare
 * against a dark page; white text clears contrast on both.
 */
const ACCENTS = {
  amber:  'from-amber-400 to-orange-500 dark:from-amber-500 dark:to-orange-600',
  orange: 'from-orange-400 to-orange-600 dark:from-orange-500 dark:to-orange-700',
  ember:  'from-orange-500 to-red-500 dark:from-orange-600 dark:to-red-600',
  rose:   'from-rose-500 to-red-600 dark:from-rose-600 dark:to-red-700',
} as const;

type StatAccent = keyof typeof ACCENTS | 'default';

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = 'default',
  secondary,
  info,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  /**
   * A named warm gradient, or 'default' for the plain theme-token tile.
   * Opt-in rather than automatic so a caller that wants the neutral
   * treatment still gets it.
   */
  accent?: StatAccent;
  /**
   * A second label + value stacked below the first, styled identically.
   * For tiles carrying two peer figures (sales and leads) that deserve
   * equal billing, rather than `sub`, which is context for the value
   * ("Cost $17,749") and stays de-emphasised.
   */
  secondary?: { label: string; value: string };
  /**
   * Shown on hover/focus: what the figures cover (date range, which sales or
   * vendors count, how it's calculated). Adds a small (i) next to the icon.
   */
  info?: ReactNode;
}) {
  const filled = accent !== 'default';
  const labelClass = `truncate text-[9px] uppercase leading-none ${filled ? 'text-white/85' : 'text-muted-foreground'}`;
  const valueClass = `truncate text-base font-bold leading-none ${filled ? 'text-white' : 'text-foreground'}`;

  const card = (
    <Card
      tabIndex={info ? 0 : undefined}
      className={[
        filled ? `border-transparent bg-gradient-to-br shadow-sm ${ACCENTS[accent]}` : '',
        info ? 'cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring' : '',
      ].join(' ').trim() || undefined}
    >
      <CardContent className="p-2">
        {/* With a secondary metric the two sit side by side as equal columns,
            which keeps the tile two lines tall — stacking them made this tile
            twice the height of its siblings, and grid stretch dragged the
            whole row up to match. */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 gap-6">
            <div className="min-w-0">
              <p className={labelClass}>{label}</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <p className={valueClass}>{value}</p>
                {sub && (
                  <p className={`truncate text-[9px] leading-none ${filled ? 'text-white/80' : 'text-muted-foreground'}`}>
                    {sub}
                  </p>
                )}
              </div>
            </div>

            {secondary && (
              <div className="min-w-0">
                <p className={labelClass}>{secondary.label}</p>
                <p className={`mt-1 ${valueClass}`}>{secondary.value}</p>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {info && <Info className={`h-3 w-3 ${filled ? 'text-white/70' : 'text-muted-foreground'}`} aria-hidden />}
            <Icon className={`h-3 w-3 ${filled ? 'text-white/85' : 'text-muted-foreground'}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!info) return card;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs space-y-1 text-left text-xs leading-snug">
        {info}
      </TooltipContent>
    </Tooltip>
  );
}
