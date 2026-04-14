export interface Vendor {
  id: string;
  name: string;
  type: string;
  monthly_cost: number;
  phone_number: string;
  email_source: string;
}

export interface Call {
  id: string;
  phone_number: string;
  vendor_id: string;
  duration: number;
  timestamp: string;
}

export interface EmailLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  vendor_id: string;
  timestamp: string;
}

export interface Sale {
  id: string;
  name: string;
  email: string;
  phone: string;
  revenue: number;
  close_date: string;
}

export interface MatchedRecord {
  lead_id: string;
  lead_type: 'call' | 'email';
  sale_id: string;
  vendor_id: string;
  match_confidence: 'high' | 'medium';
}

export interface VendorMetrics {
  vendor_id: string;
  vendor_name: string;
  total_leads: number;
  total_calls: number;
  total_email_leads: number;
  total_sales: number;
  total_revenue: number;
  cost: number;
  cpl: number;
  cpa: number;
  roi: number;
  close_rate: number;
  decision: 'CUT' | 'OPTIMIZE' | 'SCALE';
}

export interface VendorLead {
  id: string;
  vendor_id: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  body_style: string;
  dol: number;
  last_price: number;
  lotlinx_vdp: number;
  total_vdp: number;
  net_new_shoppers: number;
  pct_sales_opportunities: number;
  uploaded_at: string;
}
