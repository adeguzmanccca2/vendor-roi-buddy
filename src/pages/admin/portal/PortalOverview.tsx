import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import PortalLayout from './PortalLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, Plus, Users } from 'lucide-react';

export default function PortalOverview() {
  const [counts, setCounts] = useState({ dealerships: 0, active: 0, users: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('organizations').select('*', { count: 'exact', head: true }),
      supabase.from('organizations').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
    ]).then(([all, active, users]) => {
      setCounts({
        dealerships: all.count ?? 0,
        active: active.count ?? 0,
        users: users.count ?? 0,
      });
      setLoading(false);
    });
  }, []);

  const tiles = [
    { label: 'Total Dealerships', value: counts.dealerships, icon: Building2 },
    { label: 'Active', value: counts.active, icon: Building2 },
    { label: 'Total Users', value: counts.users, icon: Users },
  ];

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {tiles.map(t => (
            <Card key={t.label}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <t.icon className="h-4 w-4" />
                  <p className="text-xs">{t.label}</p>
                </div>
                <p className="mt-1 text-3xl font-bold text-foreground">
                  {loading ? '—' : t.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div>
              <p className="text-sm font-medium">Quick actions</p>
              <p className="text-xs text-muted-foreground">Create or manage dealerships</p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link to="/admin/portal/dealerships">View All</Link>
              </Button>
              <Button asChild>
                <Link to="/admin/portal/dealerships/new">
                  <Plus className="mr-2 h-4 w-4" />Add Dealership
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
}
