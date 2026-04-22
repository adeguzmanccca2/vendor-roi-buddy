import { useEffect, useState } from 'react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy, Mail } from 'lucide-react';

interface Org { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgs: Org[];
  onSent?: () => void;
}

const emailSchema = z.string().trim().email().max(255);

export default function InviteUserDialog({ open, onOpenChange, orgs, onSent }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'client'>('client');
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [resultLink, setResultLink] = useState<string | null>(null);
  const [resultEmailSent, setResultEmailSent] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setRole('client');
      setSelectedOrgs([]);
      setResultLink(null);
      setResultEmailSent(false);
    }
  }, [open]);

  const toggleOrg = (id: string) => {
    setSelectedOrgs(prev => prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id]);
  };

  const handleSubmit = async () => {
    const emailRes = emailSchema.safeParse(email);
    if (!emailRes.success) return toast.error('Valid email required');
    if (selectedOrgs.length === 0) return toast.error('Select at least one dealership');

    setBusy(true);
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: {
        email: emailRes.data,
        role,
        organizationIds: selectedOrgs,
        redirectOrigin: window.location.origin,
      },
    });
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data?.success) {
      toast.error(data?.error ?? 'Failed to create invitation');
      return;
    }

    setResultLink(data.acceptUrl);
    setResultEmailSent(!!data.emailSent);
    if (data.emailSent) {
      toast.success(`Invitation email sent to ${emailRes.data}`);
    } else {
      toast.success('Invitation created — share the link below');
    }
    onSent?.();
  };

  const copyLink = async () => {
    if (!resultLink) return;
    await navigator.clipboard.writeText(resultLink);
    toast.success('Link copied');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            They'll receive an email link to set their password and join the dealerships you select.
          </DialogDescription>
        </DialogHeader>

        {!resultLink ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={v => setRole(v as 'admin' | 'client')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client — access only assigned dealerships</SelectItem>
                  <SelectItem value="admin">Admin — full access to all dealerships</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Dealerships ({selectedOrgs.length} selected)</Label>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">
                {orgs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No dealerships yet — create one first.</p>
                ) : (
                  orgs.map(o => (
                    <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedOrgs.includes(o.id)}
                        onCheckedChange={() => toggleOrg(o.id)}
                      />
                      <span>{o.name}</span>
                    </label>
                  ))
                )}
              </div>
              {role === 'admin' && (
                <p className="text-xs text-muted-foreground">
                  Admins see all dealerships regardless, but the selection still creates explicit memberships.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              {resultEmailSent ? (
                <Badge variant="default" className="gap-1"><Mail className="h-3 w-3" /> Email sent</Badge>
              ) : (
                <Badge variant="secondary">Manual delivery</Badge>
              )}
            </div>
            <div className="space-y-2">
              <Label>Invite link</Label>
              <div className="flex gap-2">
                <Input value={resultLink} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={copyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {resultEmailSent
                  ? 'You can also copy this link and share it directly. It expires in 14 days.'
                  : 'Email could not be sent — share this link manually. It expires in 14 days.'}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!resultLink ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={busy}>
                {busy ? 'Sending...' : 'Send invite'}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
