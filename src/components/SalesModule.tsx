import { useState, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Plus } from 'lucide-react';
import { Sale } from '@/types/models';

export default function SalesModule() {
  const { sales, addSale, addSales } = useApp();
  const [form, setForm] = useState({ name: '', email: '', phone: '', revenue: 0, close_date: new Date().toISOString().split('T')[0] });
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addSale({ ...form, close_date: new Date(form.close_date).toISOString() });
    setForm({ name: '', email: '', phone: '', revenue: 0, close_date: new Date().toISOString().split('T')[0] });
  };

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').slice(1).filter(l => l.trim());
      const parsed: Omit<Sale, 'id'>[] = lines.map(line => {
        const [name, email, phone, revenue, close_date] = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
        return { name: name || '', email: email || '', phone: phone || '', revenue: Number(revenue) || 0, close_date: close_date ? new Date(close_date).toISOString() : new Date().toISOString() };
      });
      addSales(parsed);
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Sales</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle><Plus className="mr-2 inline h-4 w-4" />Manual Entry</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div><Label>Customer Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required /></div>
              <div><Label>Revenue ($)</Label><Input type="number" value={form.revenue} onChange={e => setForm({ ...form, revenue: Number(e.target.value) })} required /></div>
              <div><Label>Close Date</Label><Input type="date" value={form.close_date} onChange={e => setForm({ ...form, close_date: e.target.value })} /></div>
              <Button type="submit" className="w-full">Add Sale</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle><Upload className="mr-2 inline h-4 w-4" />CSV Upload</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Upload a CSV with columns: name, email, phone, revenue, close_date</p>
            <Input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>All Sales ({sales.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Close Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.slice().reverse().map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.email}</TableCell>
                  <TableCell>{s.phone}</TableCell>
                  <TableCell>${s.revenue.toLocaleString()}</TableCell>
                  <TableCell>{new Date(s.close_date).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
