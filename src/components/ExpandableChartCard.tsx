import { ReactNode, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Maximize2 } from 'lucide-react';

/**
 * A chart card that stays compact on the dashboard but expands to a
 * near-fullscreen overlay on demand.
 *
 * WHY the chart element is rendered in both places rather than moved: every
 * chart here is wrapped in recharts' ResponsiveContainer, which measures its
 * parent and redraws to fit. Rendering the same element inside the small card
 * and again inside the dialog therefore needs no size plumbing at all -- each
 * copy simply fills whatever container it lands in. Only one is mounted at a
 * time in practice, since the dialog content does not exist until it opens.
 */
export function ExpandableChartCard({
  title,
  description,
  children,
  footer,
  compactClassName = 'h-48',
  expandedClassName = 'h-[72vh]',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  /**
   * Rendered below the chart, OUTSIDE the fixed-height area, in both the
   * compact and expanded views — for legends and similar, which would
   * otherwise be squeezed into the chart's own height budget.
   */
  footer?: ReactNode;
  /** Height of the inline (dashboard) chart. */
  compactClassName?: string;
  /** Height of the chart inside the expanded overlay. */
  expandedClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 -mt-1 shrink-0"
            onClick={() => setOpen(true)}
            title="Expand chart"
            aria-label={`Expand ${title}`}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className={compactClassName}>{children}</div>
          {footer}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </DialogHeader>
          <div className={expandedClassName}>{children}</div>
          {footer}
        </DialogContent>
      </Dialog>
    </>
  );
}
