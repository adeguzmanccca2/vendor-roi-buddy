import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Vendor } from '@/types/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';

const VENDOR_TYPES = ['Google Ads', 'TruckPaper', 'Facebook', 'AutoTrader', 'Direct Mail', 'Other'];

const emptyForm = { name: '', type: 'Google Ads', monthly_cost: 0, phone_number: '', email_source: '' };

export default function VendorManagement() {
  const { vendors, addVendor, updateVendor, deleteVendor } = useApp();
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editId) {
      updateVendor({ ...form, id: editId } as Vendor);
    } else {
      addVendor(form);
    }
    setForm(emptyForm);
    setEditId(null);
    setOpen(false);
  };

  const startEdit = (v: Vendor) => {
    setForm({ name: v.name, type: v.type, monthly_cost: v.monthly_cost, phone_number: v.phone_number, email_source: v.email_source });
    setEditId(v.id);
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Vendor Management</h1>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(emptyForm); setEditId(null); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Add Vendor</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Add'} Vendor</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
              <div><Label>Type</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {VENDOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><Label>Monthly Cost ($)</Label><Input type="number" value={form.monthly_cost} onChange={e => setForm({ ...form, monthly_cost: Number(e.target.value) })} required /></div>
              <div><Label>Tracking Phone</Label><Input value={form.phone_number} onChange={e => setForm({ ...form, phone_number: e.target.value })} placeholder="555-100-0001" /></div>
              <div><Label>Email Source</Label><Input value={form.email_source} onChange={e => setForm({ ...form, email_source: e.target.value })} placeholder="source@leads.dealer.com" /></div>
              <Button type="submit" className="w-full">{editId ? 'Update' : 'Add'} Vendor</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>All Vendors</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Monthly Cost</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email Source</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map(v => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell>{v.type}</TableCell>
                  <TableCell>${v.monthly_cost.toLocaleString()}</TableCell>
                  <TableCell>{v.phone_number}</TableCell>
                  <TableCell>{v.email_source}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(v)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteVendor(v.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
