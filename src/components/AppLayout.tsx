import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Building2, Phone, ShoppingCart, Link2, Car } from 'lucide-react';
import { cn } from '@/lib/utils';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/vendors', label: 'Vendors', icon: Building2 },
  { to: '/leads', label: 'Leads', icon: Phone },
  { to: '/sales', label: 'Sales', icon: ShoppingCart },
  { to: '/matching', label: 'Matching', icon: Link2 },
  { to: '/vendor-leads', label: 'Vendor Leads', icon: Car },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold text-foreground">Vendor ROI</h2>
          <p className="text-xs text-muted-foreground">Auto Dealership Tracker</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                location.pathname === link.to
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Mobile nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card lg:hidden">
        {links.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2 text-xs',
              location.pathname === link.to ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <link.icon className="h-5 w-5" />
            {link.label}
          </NavLink>
        ))}
      </div>

      <main className="flex-1 overflow-auto p-6 pb-20 lg:pb-6">
        {children}
      </main>
    </div>
  );
}
