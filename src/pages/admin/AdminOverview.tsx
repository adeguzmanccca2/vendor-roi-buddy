import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, Users, Shield } from 'lucide-react';

export default function AdminOverview() {
  const [counts, setCounts] = useState({ dealerships: 0, users: 0, admins: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('organizations').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'admin'),
    ]).then(([d, u, a]) => {
      setCounts({
        dealerships: d.count ?? 0,
        users: u.count ?? 0,
        admins: a.count ?? 0,
      });
      setLoading(false);
    });
  }, []);

  const cards = [
    { label: 'Dealerships', value: counts.dealerships, icon: Building2, color: 'text-primary bg-primary/10' },
    { label: 'Total Users', value: counts.users, icon: Users, color: 'text-accent bg-accent/10' },
    { label: 'Admins', value: counts.admins, icon: Shield, color: 'text-warning bg-warning/10' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Overview</h1>
        <p className="text-sm text-muted-foreground">System-wide metrics across all dealerships</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map(c => (
          <Card key={c.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${c.color}`}>
                  <c.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{c.label}</p>
                  <p className="text-2xl font-bold text-foreground">{loading ? '—' : c.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
