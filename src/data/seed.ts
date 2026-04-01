import { Vendor, Call, EmailLead, Sale } from '@/types/models';

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000).toISOString();

export const seedVendors: Vendor[] = [
  { id: 'v1', name: 'Google Ads', type: 'Google Ads', monthly_cost: 5000, phone_number: '555-100-0001', email_source: 'google@leads.dealer.com' },
  { id: 'v2', name: 'TruckPaper', type: 'TruckPaper', monthly_cost: 2000, phone_number: '555-100-0002', email_source: 'truckpaper@leads.dealer.com' },
  { id: 'v3', name: 'Facebook Ads', type: 'Facebook', monthly_cost: 3000, phone_number: '555-100-0003', email_source: 'facebook@leads.dealer.com' },
  { id: 'v4', name: 'AutoTrader', type: 'AutoTrader', monthly_cost: 4000, phone_number: '555-100-0004', email_source: 'autotrader@leads.dealer.com' },
  { id: 'v5', name: 'Direct Mail', type: 'Direct Mail', monthly_cost: 1500, phone_number: '555-100-0005', email_source: 'mail@leads.dealer.com' },
];

export const seedCalls: Call[] = [
  { id: 'c1', phone_number: '555-200-0001', vendor_id: 'v1', duration: 180, timestamp: daysAgo(45) },
  { id: 'c2', phone_number: '555-200-0002', vendor_id: 'v1', duration: 90, timestamp: daysAgo(40) },
  { id: 'c3', phone_number: '555-200-0003', vendor_id: 'v1', duration: 240, timestamp: daysAgo(35) },
  { id: 'c4', phone_number: '555-200-0004', vendor_id: 'v2', duration: 120, timestamp: daysAgo(50) },
  { id: 'c5', phone_number: '555-200-0005', vendor_id: 'v2', duration: 300, timestamp: daysAgo(30) },
  { id: 'c6', phone_number: '555-200-0006', vendor_id: 'v3', duration: 60, timestamp: daysAgo(20) },
  { id: 'c7', phone_number: '555-200-0007', vendor_id: 'v3', duration: 150, timestamp: daysAgo(15) },
  { id: 'c8', phone_number: '555-200-0008', vendor_id: 'v4', duration: 200, timestamp: daysAgo(25) },
  { id: 'c9', phone_number: '555-200-0009', vendor_id: 'v4', duration: 100, timestamp: daysAgo(10) },
  { id: 'c10', phone_number: '555-200-0010', vendor_id: 'v5', duration: 45, timestamp: daysAgo(55) },
];

export const seedEmailLeads: EmailLead[] = [
  { id: 'e1', name: 'John Smith', email: 'john@example.com', phone: '555-200-0001', vendor_id: 'v1', timestamp: daysAgo(44) },
  { id: 'e2', name: 'Jane Doe', email: 'jane@example.com', phone: '555-200-0011', vendor_id: 'v1', timestamp: daysAgo(38) },
  { id: 'e3', name: 'Bob Wilson', email: 'bob@example.com', phone: '555-200-0012', vendor_id: 'v2', timestamp: daysAgo(48) },
  { id: 'e4', name: 'Alice Brown', email: 'alice@example.com', phone: '555-200-0005', vendor_id: 'v2', timestamp: daysAgo(28) },
  { id: 'e5', name: 'Charlie Davis', email: 'charlie@example.com', phone: '555-200-0013', vendor_id: 'v3', timestamp: daysAgo(18) },
  { id: 'e6', name: 'Diana Evans', email: 'diana@example.com', phone: '555-200-0014', vendor_id: 'v3', timestamp: daysAgo(12) },
  { id: 'e7', name: 'Frank Garcia', email: 'frank@example.com', phone: '555-200-0008', vendor_id: 'v4', timestamp: daysAgo(22) },
  { id: 'e8', name: 'Grace Hall', email: 'grace@example.com', phone: '555-200-0015', vendor_id: 'v4', timestamp: daysAgo(8) },
  { id: 'e9', name: 'Henry Lee', email: 'henry@example.com', phone: '555-200-0010', vendor_id: 'v5', timestamp: daysAgo(52) },
  { id: 'e10', name: 'Ivy Martin', email: 'ivy@example.com', phone: '555-200-0016', vendor_id: 'v5', timestamp: daysAgo(5) },
];

export const seedSales: Sale[] = [
  { id: 's1', name: 'John Smith', email: 'john@example.com', phone: '555-200-0001', revenue: 35000, close_date: daysAgo(10) },
  { id: 's2', name: 'Bob Wilson', email: 'bob@example.com', phone: '555-200-0012', revenue: 28000, close_date: daysAgo(15) },
  { id: 's3', name: 'Alice Brown', email: 'alice@example.com', phone: '555-200-0005', revenue: 42000, close_date: daysAgo(5) },
  { id: 's4', name: 'Frank Garcia', email: 'frank@example.com', phone: '555-200-0008', revenue: 18000, close_date: daysAgo(3) },
  { id: 's5', name: 'Charlie Davis', email: 'charlie@example.com', phone: '555-200-0013', revenue: 22000, close_date: daysAgo(7) },
  { id: 's6', name: 'Grace Hall', email: 'grace@example.com', phone: '555-200-0015', revenue: 55000, close_date: daysAgo(2) },
];
