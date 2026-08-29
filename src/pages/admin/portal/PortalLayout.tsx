import { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Building2, LayoutDashboard, UserPlus, FileClock } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '/admin/portal', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/portal/dealerships', label: 'Dealerships', icon: Building2 },
  { to: '/admin/portal/dealerships/new', label: 'Add Dealership', icon: UserPlus },
  { to: '/admin/portal/dms-logs', label: 'Import Logs', icon: FileClock },
];

export default function PortalLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Admin Portal</p>
        <h1 className="text-2xl font-bold text-foreground">Dealership Management</h1>
      </div>

      <div className="border-b border-border">
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map(t => {
            const active = t.end
              ? location.pathname === t.to
              : location.pathname.startsWith(t.to);
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div>{children}</div>
    </div>
  );
}
