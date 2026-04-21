import { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Building2, Users, LogOut, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { isAdmin, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const adminLinks = [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/dealerships', label: 'Dealerships', icon: Building2 },
    { to: '/admin/users', label: 'Users', icon: Users },
  ];

  const clientLinks = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  ];

  const links = isAdmin ? adminLinks : clientLinks;

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            {isAdmin && <Shield className="h-4 w-4 text-primary" />}
            <h2 className="text-lg font-bold text-foreground">Vendor ROI</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {isAdmin ? 'Admin Portal' : 'Dealership Portal'}
          </p>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {links.map(link => {
            const active = link.end
              ? location.pathname === link.to
              : location.pathname.startsWith(link.to);
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 px-3">
            <p className="truncate text-sm font-medium text-foreground">{profile?.full_name ?? 'User'}</p>
            <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
        <div>
          <h2 className="text-sm font-bold text-foreground">Vendor ROI</h2>
          <p className="text-xs text-muted-foreground">{isAdmin ? 'Admin' : 'Dealership'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Mobile bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card lg:hidden">
        {links.map(link => {
          const active = link.end
            ? location.pathname === link.to
            : location.pathname.startsWith(link.to);
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2 text-xs',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <link.icon className="h-5 w-5" />
              {link.label}
            </NavLink>
          );
        })}
      </div>

      <main className="flex-1 overflow-auto p-6 pb-20 pt-20 lg:pb-6 lg:pt-6">{children}</main>
    </div>
  );
}
