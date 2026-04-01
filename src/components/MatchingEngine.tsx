import { useApp } from '@/context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function MatchingEngine() {
  const { vendors, calls, emailLeads, sales, getMatches } = useApp();
  const matches = getMatches();

  const getLeadInfo = (m: typeof matches[0]) => {
    if (m.lead_type === 'call') {
      const call = calls.find(c => c.id === m.lead_id);
      return { label: `Call: ${call?.phone_number}`, date: call?.timestamp };
    }
    const email = emailLeads.find(e => e.id === m.lead_id);
    return { label: `Email: ${email?.name}`, date: email?.timestamp };
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Matching Engine</h1>
      <p className="text-muted-foreground">Leads matched to sales by phone (high confidence) or email (medium confidence) within 60-day window.</p>

      <Card>
        <CardHeader><CardTitle>Matched Records ({matches.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Lead Date</TableHead>
                <TableHead>Sale</TableHead>
                <TableHead>Sale Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((m, i) => {
                const info = getLeadInfo(m);
                const sale = sales.find(s => s.id === m.sale_id);
                const vendor = vendors.find(v => v.id === m.vendor_id);
                return (
                  <TableRow key={i}>
                    <TableCell>{info.label}</TableCell>
                    <TableCell>{info.date ? new Date(info.date).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="font-medium">{sale?.name} (${sale?.revenue.toLocaleString()})</TableCell>
                    <TableCell>{sale ? new Date(sale.close_date).toLocaleDateString() : '—'}</TableCell>
                    <TableCell>{vendor?.name}</TableCell>
                    <TableCell>
                      <Badge variant={m.match_confidence === 'high' ? 'default' : 'secondary'}>
                        {m.match_confidence}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {matches.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No matches found. Add leads and sales to see matches.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
