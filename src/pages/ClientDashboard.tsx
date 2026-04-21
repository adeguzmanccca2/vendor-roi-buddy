import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Info } from 'lucide-react';

interface Org {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export default function ClientDashboard() {
  const { profile } = useAuth();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false);
      return;
    }
    supabase
      .from('organizations')
      .select('id, name, slug, status')
      .eq('id', profile.organization_id)
      .maybeSingle()
      .then(({ data }) => {
        setOrg(data);
        setLoading(false);
      });
  }, [profile?.organization_id]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  if (!profile?.organization_id) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Welcome</h1>
        <Card>
          <CardContent className="flex items-start gap-3 pt-6">
            <Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">No dealership assigned yet</p>
              <p className="text-sm text-muted-foreground">
                Your account hasn't been linked to a dealership. Please contact your administrator.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{org?.name ?? 'Dashboard'}</h1>
        <p className="text-sm text-muted-foreground">Dealership ROI &amp; vendor performance</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Dealership
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Name:</span> {org?.name}</p>
          <p><span className="text-muted-foreground">Slug:</span> {org?.slug}</p>
          <p><span className="text-muted-foreground">Status:</span> {org?.status}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Vendor management, lead ingestion, attribution, and ROI dashboards will appear here in upcoming phases.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
