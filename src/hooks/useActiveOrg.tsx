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
  const { user, isAdmin } = useAuth();
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
      // Admins see all organizations
      supabase
        .from('organizations')
        .select('id, name')
        .order('name')
        .then(({ data }) => {
          const list = (data ?? []) as Org[];
          setOrgs(list);
          const stored = localStorage.getItem(STORAGE_KEY);
          const initial = stored && list.find(o => o.id === stored) ? stored : list[0]?.id ?? null;
          setActiveOrgIdState(initial);
          setLoading(false);
        });
    } else {
      // WHY: Instead of reading profile.organization_id (single org), we query
      // user_organizations to get ALL orgs this user belongs to. This lets a
      // user like "Bayshore Ford + Bayshore Trucks" switch between both without
      // needing admin access.
      supabase
        .from('user_organizations')
        .select('organization_id, organizations(id, name)')
        .eq('user_id', user.id)
        .then(({ data, error }) => {
          if (error || !data || data.length === 0) {
            setOrgs([]);
            setActiveOrgIdState(null);
            setLoading(false);
            return;
          }

          // Flatten the joined org records
          const list: Org[] = data
            .map((row: any) => row.organizations)
            .filter(Boolean)
            .sort((a: Org, b: Org) => a.name.localeCompare(b.name));

          setOrgs(list);

          // Restore last-used org from localStorage if still valid,
          // otherwise default to first org in the list.
          const stored = localStorage.getItem(STORAGE_KEY);
          const initial =
            stored && list.find(o => o.id === stored)
              ? stored
              : list[0]?.id ?? null;
          setActiveOrgIdState(initial);
          setLoading(false);
        });
    }
  }, [user, isAdmin]);

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
