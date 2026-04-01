import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Phone, Mail } from 'lucide-react';

function parseEmailText(raw: string): { name: string; email: string; phone: string } {
  const emailMatch = raw.match(/[\w.-]+@[\w.-]+\.\w+/);
  const phoneMatch = raw.match(/(\+?1?\s?[-.]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  let name = '';
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('name:')) { name = line.slice(5).trim(); break; }
    if (lower.startsWith('from:')) { name = line.slice(5).trim().replace(/<.*>/, '').trim(); break; }
    if (!line.includes('@') && !phoneMatch?.input?.includes(line) && line.length < 60 && /^[A-Z]/.test(line)) {
      name = line; break;
    }
  }

  return { name, email: emailMatch?.[0] || '', phone: phoneMatch?.[1] || '' };
}

export default function LeadCapture() {
  const { vendors, calls, emailLeads, addCall, addEmailLead } = useApp();
  const [callForm, setCallForm] = useState({ phone_number: '', vendor_id: '', duration: 0 });
  const [rawEmail, setRawEmail] = useState('');
  const [parsedEmail, setParsedEmail] = useState({ name: '', email: '', phone: '', vendor_id: '' });
  const [showParsed, setShowParsed] = useState(false);

  const handleCallSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addCall({ ...callForm, timestamp: new Date().toISOString() });
    setCallForm({ phone_number: '', vendor_id: '', duration: 0 });
  };

  const handleParseEmail = () => {
    const parsed = parseEmailText(rawEmail);
    setParsedEmail({ ...parsed, vendor_id: vendors[0]?.id || '' });
    setShowParsed(true);
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addEmailLead({ ...parsedEmail, timestamp: new Date().toISOString() });
    setRawEmail('');
    setParsedEmail({ name: '', email: '', phone: '', vendor_id: '' });
    setShowParsed(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Lead Capture</h1>

      <Tabs defaultValue="calls">
        <TabsList>
          <TabsTrigger value="calls"><Phone className="mr-2 h-4 w-4" />Calls</TabsTrigger>
          <TabsTrigger value="emails"><Mail className="mr-2 h-4 w-4" />Email Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="calls" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Log a Call</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleCallSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div><Label>Phone Number</Label><Input value={callForm.phone_number} onChange={e => setCallForm({ ...callForm, phone_number: e.target.value })} required /></div>
                <div><Label>Vendor</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={callForm.vendor_id} onChange={e => setCallForm({ ...callForm, vendor_id: e.target.value })} required>
                    <option value="">Select...</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div><Label>Duration (sec)</Label><Input type="number" value={callForm.duration} onChange={e => setCallForm({ ...callForm, duration: Number(e.target.value) })} /></div>
                <div className="flex items-end"><Button type="submit" className="w-full">Log Call</Button></div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Calls ({calls.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phone</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.slice(-20).reverse().map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{c.phone_number}</TableCell>
                      <TableCell>{vendors.find(v => v.id === c.vendor_id)?.name || '—'}</TableCell>
                      <TableCell>{c.duration}s</TableCell>
                      <TableCell>{new Date(c.timestamp).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="emails" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Parse Email Lead</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Paste raw email text</Label>
                <Textarea rows={6} value={rawEmail} onChange={e => setRawEmail(e.target.value)} placeholder="Name: John Smith&#10;Email: john@example.com&#10;Phone: 555-200-1234&#10;..." />
              </div>
              <Button type="button" onClick={handleParseEmail} disabled={!rawEmail.trim()}>Parse Email</Button>

              {showParsed && (
                <form onSubmit={handleEmailSubmit} className="space-y-3 rounded-md border border-border p-4">
                  <p className="text-sm font-medium text-muted-foreground">Parsed Fields (edit if needed):</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div><Label>Name</Label><Input value={parsedEmail.name} onChange={e => setParsedEmail({ ...parsedEmail, name: e.target.value })} /></div>
                    <div><Label>Email</Label><Input value={parsedEmail.email} onChange={e => setParsedEmail({ ...parsedEmail, email: e.target.value })} /></div>
                    <div><Label>Phone</Label><Input value={parsedEmail.phone} onChange={e => setParsedEmail({ ...parsedEmail, phone: e.target.value })} /></div>
                    <div><Label>Vendor</Label>
                      <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={parsedEmail.vendor_id} onChange={e => setParsedEmail({ ...parsedEmail, vendor_id: e.target.value })}>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <Button type="submit">Save Lead</Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Email Leads ({emailLeads.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emailLeads.slice(-20).reverse().map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell>{e.email}</TableCell>
                      <TableCell>{e.phone}</TableCell>
                      <TableCell>{vendors.find(v => v.id === e.vendor_id)?.name || '—'}</TableCell>
                      <TableCell>{new Date(e.timestamp).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
