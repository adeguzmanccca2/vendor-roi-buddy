import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Vendor, Call, EmailLead, Sale, MatchedRecord, VendorMetrics } from '@/types/models';
import { seedVendors, seedCalls, seedEmailLeads, seedSales } from '@/data/seed';

interface AppState {
  vendors: Vendor[];
  calls: Call[];
  emailLeads: EmailLead[];
  sales: Sale[];
}

interface AppContextType extends AppState {
  addVendor: (v: Omit<Vendor, 'id'>) => void;
  updateVendor: (v: Vendor) => void;
  deleteVendor: (id: string) => void;
  addCall: (c: Omit<Call, 'id'>) => void;
  addEmailLead: (e: Omit<EmailLead, 'id'>) => void;
  addSale: (s: Omit<Sale, 'id'>) => void;
  addSales: (s: Omit<Sale, 'id'>[]) => void;
  getMatches: () => MatchedRecord[];
  getMetrics: () => VendorMetrics[];
}

const AppContext = createContext<AppContextType | null>(null);

const STORAGE_KEY = 'vendor-roi-tracker';

function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { vendors: seedVendors, calls: seedCalls, emailLeads: seedEmailLeads, sales: seedSales };
}

function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let idCounter = Date.now();
const genId = () => (idCounter++).toString(36);

function normalizePhone(p: string) {
  return p.replace(/\D/g, '');
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);

  const update = useCallback((fn: (s: AppState) => AppState) => {
    setState(prev => {
      const next = fn(prev);
      saveState(next);
      return next;
    });
  }, []);

  const addVendor = (v: Omit<Vendor, 'id'>) => update(s => ({ ...s, vendors: [...s.vendors, { ...v, id: genId() }] }));
  const updateVendor = (v: Vendor) => update(s => ({ ...s, vendors: s.vendors.map(x => x.id === v.id ? v : x) }));
  const deleteVendor = (id: string) => update(s => ({ ...s, vendors: s.vendors.filter(x => x.id !== id) }));
  const addCall = (c: Omit<Call, 'id'>) => update(s => ({ ...s, calls: [...s.calls, { ...c, id: genId() }] }));
  const addEmailLead = (e: Omit<EmailLead, 'id'>) => update(s => ({ ...s, emailLeads: [...s.emailLeads, { ...e, id: genId() }] }));
  const addSale = (s: Omit<Sale, 'id'>) => update(st => ({ ...st, sales: [...st.sales, { ...s, id: genId() }] }));
  const addSales = (sales: Omit<Sale, 'id'>[]) => update(st => ({ ...st, sales: [...st.sales, ...sales.map(s => ({ ...s, id: genId() }))] }));

  const getMatches = useCallback((): MatchedRecord[] => {
    const matches: MatchedRecord[] = [];
    const SIXTY_DAYS = 60 * 86400000;

    for (const sale of state.sales) {
      const saleDate = new Date(sale.close_date).getTime();
      const salePhone = normalizePhone(sale.phone);
      const saleEmail = sale.email.toLowerCase();

      // Check calls
      for (const call of state.calls) {
        const callPhone = normalizePhone(call.phone_number);
        const callDate = new Date(call.timestamp).getTime();
        if (callPhone === salePhone && saleDate - callDate >= 0 && saleDate - callDate <= SIXTY_DAYS) {
          matches.push({ lead_id: call.id, lead_type: 'call', sale_id: sale.id, vendor_id: call.vendor_id, match_confidence: 'high' });
        }
      }

      // Check email leads
      for (const lead of state.emailLeads) {
        const leadPhone = normalizePhone(lead.phone);
        const leadEmail = lead.email.toLowerCase();
        const leadDate = new Date(lead.timestamp).getTime();
        const withinWindow = saleDate - leadDate >= 0 && saleDate - leadDate <= SIXTY_DAYS;

        if (withinWindow) {
          if (leadPhone === salePhone) {
            matches.push({ lead_id: lead.id, lead_type: 'email', sale_id: sale.id, vendor_id: lead.vendor_id, match_confidence: 'high' });
          } else if (leadEmail === saleEmail) {
            matches.push({ lead_id: lead.id, lead_type: 'email', sale_id: sale.id, vendor_id: lead.vendor_id, match_confidence: 'medium' });
          }
        }
      }
    }
    return matches;
  }, [state.sales, state.calls, state.emailLeads]);

  const getMetrics = useCallback((): VendorMetrics[] => {
    const matches = getMatches();

    return state.vendors.map(vendor => {
      const vendorCalls = state.calls.filter(c => c.vendor_id === vendor.id);
      const vendorEmails = state.emailLeads.filter(e => e.vendor_id === vendor.id);
      const totalLeads = vendorCalls.length + vendorEmails.length;

      const vendorMatches = matches.filter(m => m.vendor_id === vendor.id);
      const matchedSaleIds = [...new Set(vendorMatches.map(m => m.sale_id))];
      const matchedSales = state.sales.filter(s => matchedSaleIds.includes(s.id));
      const totalRevenue = matchedSales.reduce((sum, s) => sum + s.revenue, 0);
      const cost = vendor.monthly_cost;

      const roi = cost > 0 ? (totalRevenue - cost) / cost : 0;
      const decision: 'CUT' | 'OPTIMIZE' | 'SCALE' = roi < 0 ? 'CUT' : roi <= 1 ? 'OPTIMIZE' : 'SCALE';

      return {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        total_leads: totalLeads,
        total_calls: vendorCalls.length,
        total_email_leads: vendorEmails.length,
        total_sales: matchedSales.length,
        total_revenue: totalRevenue,
        cost,
        cpl: totalLeads > 0 ? cost / totalLeads : 0,
        cpa: matchedSales.length > 0 ? cost / matchedSales.length : 0,
        roi,
        close_rate: totalLeads > 0 ? matchedSales.length / totalLeads : 0,
        decision,
      };
    });
  }, [state.vendors, state.calls, state.emailLeads, state.sales, getMatches]);

  return (
    <AppContext.Provider value={{ ...state, addVendor, updateVendor, deleteVendor, addCall, addEmailLead, addSale, addSales, getMatches, getMetrics }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
