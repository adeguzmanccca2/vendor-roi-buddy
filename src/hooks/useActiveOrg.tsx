import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface Org { id: string; name: string }

interface Ctx {
  orgs: Org[];
  activeOrgId: string | null;
  setActiveOrgId: (id: string | null) => void;
  activeOrg: Org | null;
  loading: boolean;
}

const ActiveOrgContext = createContext<Ctx | null>(null);

const STORAGE_KEY = 'vroi.activeOrgId';

export function ActiveOrgProvider({ children }: { children: ReactNode }) {
  const { user, profile, isAdmin } = useAuth();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setOrgs([]);
      setActiveOrgIdState(null);
      setLoading(false);
      return;
    }

    if (isAdmin) {
      supabase.from('organizations').select('id, name').order('name').then(({ data }) => {
        const list = (data ?? []) as Org[];
        setOrgs(list);
        const stored = localStorage.getItem(STORAGE_KEY);
        const initial = stored && list.find(o => o.id === stored) ? stored : list[0]?.id ?? null;
        setActiveOrgIdState(initial);
        setLoading(false);
      });
    } else {
      // Client: pinned to their assigned org
      if (profile?.organization_id) {
        supabase
          .from('organizations')
          .select('id, name')
          .eq('id', profile.organization_id)
          .maybeSingle()
          .then(({ data }) => {
            if (data) {
              setOrgs([data as Org]);
              setActiveOrgIdState(data.id);
            }
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    }
  }, [user, isAdmin, profile?.organization_id]);

  const setActiveOrgId = (id: string | null) => {
    setActiveOrgIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  };

  const activeOrg = orgs.find(o => o.id === activeOrgId) ?? null;

  return (
    <ActiveOrgContext.Provider value={{ orgs, activeOrgId, setActiveOrgId, activeOrg, loading }}>
      {children}
    </ActiveOrgContext.Provider>
  );
}

export function useActiveOrg() {
  const ctx = useContext(ActiveOrgContext);
  if (!ctx) throw new Error('useActiveOrg must be used within ActiveOrgProvider');
  return ctx;
}
