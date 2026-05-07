import { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Building2, Users, LogOut, Shield, Store, ListChecks, TrendingUp, GitBranch, Car, Receipt, Plug } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useActiveOrg } from '@/hooks/useActiveOrg';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { isAdmin, profile, signOut } = useAuth();
  const { orgs, activeOrgId, setActiveOrgId, activeOrg } = useActiveOrg();
  const navigate = useNavigate();
  const location = useLocation();

  const adminLinks = [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/portal/dealerships', label: 'Dealerships', icon: Building2 },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/vendors', label: 'Vendors', icon: Store },
    { to: '/leads', label: 'Leads', icon: ListChecks },
    { to: '/sales', label: 'Sales', icon: Receipt },
    { to: '/attribution', label: 'Attribution', icon: TrendingUp },
    { to: '/source-rules', label: 'Source Rules', icon: GitBranch },
    { to: '/inventory', label: 'Inventory', icon: Car },
    { to: '/integrations', label: 'Integrations', icon: Plug },
  ];

  const clientLinks = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/vendors', label: 'Vendors', icon: Store },
    { to: '/leads', label: 'Leads', icon: ListChecks },
    { to: '/sales', label: 'Sales', icon: Receipt },
    { to: '/attribution', label: 'Attribution', icon: TrendingUp },
    { to: '/source-rules', label: 'Source Rules', icon: GitBranch },
    { to: '/inventory', label: 'Inventory', icon: Car },
    { to: '/integrations', label: 'Integrations', icon: Plug },
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

        {isAdmin && orgs.length > 0 && (
          <div className="border-b border-border p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">Active dealership</p>
            <Select value={activeOrgId ?? ''} onValueChange={v => setActiveOrgId(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose..." /></SelectTrigger>
              <SelectContent>
                {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {!isAdmin && activeOrg && (
          <div className="border-b border-border p-3">
            <p className="px-1 text-xs text-muted-foreground">Dealership</p>
            <p className="px-1 text-sm font-medium text-foreground">{activeOrg.name}</p>
          </div>
        )}

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
          <p className="mt-2 px-3 text-[10px] text-muted-foreground">v{__COMMIT_HASH__}</p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-foreground">Vendor ROI</h2>
          <p className="truncate text-xs text-muted-foreground">{activeOrg?.name ?? (isAdmin ? 'Admin' : 'Dealership')}</p>
        </div>
        {isAdmin && orgs.length > 0 && (
          <Select value={activeOrgId ?? ''} onValueChange={v => setActiveOrgId(v)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Org" /></SelectTrigger>
            <SelectContent>
              {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Mobile bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex overflow-x-auto border-t border-border bg-card lg:hidden">
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
                'flex flex-1 min-w-[70px] flex-col items-center gap-1 py-2 text-[10px]',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </NavLink>
          );
        })}
      </div>

      <main className="flex-1 overflow-auto p-6 pb-20 pt-20 lg:pb-6 lg:pt-6">{children}</main>
    </div>
  );
}
