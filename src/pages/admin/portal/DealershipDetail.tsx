import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import PortalLayout from './PortalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, Pencil, X } from 'lucide-react';

interface Org {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  website: string | null;
  contact_person: string | null;
}

type FormState = {
  name: string;
  slug: string;
  status: string;
  phone: string;
  email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  website: string;
  contact_person: string;
};

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-medium text-foreground ${mono ? 'font-mono' : ''}`}>
        {value || <span className="font-normal text-muted-foreground">—</span>}
      </p>
    </div>
  );
}

export default function DealershipDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) {
      toast.error('Dealership not found');
      navigate('/admin/portal/dealerships');
      return;
    }
    setOrg(data as Org);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const startEdit = () => {
    if (!org) return;
    setForm({
      name: org.name,
      slug: org.slug,
      status: org.status,
      phone: org.phone ?? '',
      email: org.email ?? '',
      address_line1: org.address_line1 ?? '',
      address_line2: org.address_line2 ?? '',
      city: org.city ?? '',
      state: org.state ?? '',
      zip_code: org.zip_code ?? '',
      country: org.country ?? '',
      website: org.website ?? '',
      contact_person: org.contact_person ?? '',
    });
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setForm(null); };

  const handleSave = async () => {
    if (!form || !id) return;
    if (!form.name.trim() || form.name.trim().length < 2)
      return toast.error('Name must be at least 2 characters');
    if (!/^[a-z0-9-]+$/.test(form.slug.trim()))
      return toast.error('Slug: lowercase letters, numbers, and hyphens only');

    setBusy(true);
    const { error } = await supabase
      .from('organizations')
      .update({
        name: form.name.trim(),
        slug: form.slug.trim(),
        status: form.status,
        phone: form.phone || null,
        email: form.email || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        city: form.city || null,
        state: form.state || null,
        zip_code: form.zip_code || null,
        country: form.country || null,
        website: form.website || null,
        contact_person: form.contact_person || null,
      })
      .eq('id', id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Dealership updated');
    cancelEdit();
    await load();
  };

  if (loading) {
    return (
      <PortalLayout>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </PortalLayout>
    );
  }

  if (!org) return null;

  return (
    <PortalLayout>
      <div className="max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/portal/dealerships')}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to list
        </Button>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-base">{org.name}</CardTitle>
            {!editing ? (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="mr-2 h-4 w-4" />Edit
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                <X className="mr-2 h-4 w-4" />Cancel
              </Button>
            )}
          </CardHeader>

          <CardContent>
            {!editing ? (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" value={org.name} />
                  <Field label="Slug" value={org.slug} mono />
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <div className="mt-0.5">
                      <Badge variant={org.status === 'active' ? 'default' : 'secondary'}>{org.status}</Badge>
                    </div>
                  </div>
                  <Field label="Created" value={new Date(org.created_at).toLocaleDateString()} />
                </div>

                <div className="border-t border-border pt-4">
                  <p className="mb-3 text-sm font-medium text-foreground">Contact Information</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Contact person" value={org.contact_person} />
                    <Field label="Phone" value={org.phone} />
                    <Field label="Email" value={org.email} />
                    <Field label="Website" value={org.website} />
                    <Field label="Address line 1" value={org.address_line1} />
                    <Field label="Address line 2" value={org.address_line2} />
                    <Field label="City" value={org.city} />
                    <Field label="State" value={org.state} />
                    <Field label="ZIP code" value={org.zip_code} />
                    <Field label="Country" value={org.country} />
                  </div>
                </div>
              </div>
            ) : (
              form && (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Slug</Label>
                      <Input
                        value={form.slug}
                        onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                      />
                      <p className="text-xs text-muted-foreground">Lowercase letters, numbers, hyphens.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="mb-3 text-sm font-medium text-foreground">Contact Information</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Contact person</Label>
                        <Input
                          value={form.contact_person}
                          onChange={e => setForm({ ...form, contact_person: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Phone</Label>
                        <Input
                          value={form.phone}
                          onChange={e => setForm({ ...form, phone: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={form.email}
                          onChange={e => setForm({ ...form, email: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Website</Label>
                        <Input
                          value={form.website}
                          onChange={e => setForm({ ...form, website: e.target.value })}
                          placeholder="https://"
                        />
                      </div>
                      <div className="sm:col-span-2 space-y-2">
                        <Label>Address line 1</Label>
                        <Input
                          value={form.address_line1}
                          onChange={e => setForm({ ...form, address_line1: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2 space-y-2">
                        <Label>Address line 2</Label>
                        <Input
                          value={form.address_line2}
                          onChange={e => setForm({ ...form, address_line2: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>City</Label>
                        <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>State</Label>
                        <Input value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>ZIP code</Label>
                        <Input value={form.zip_code} onChange={e => setForm({ ...form, zip_code: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Country</Label>
                        <Input
                          value={form.country}
                          onChange={e => setForm({ ...form, country: e.target.value })}
                          placeholder="US"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleSave} disabled={busy}>
                      {busy ? 'Saving...' : 'Save changes'}
                    </Button>
                    <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
                  </div>
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
}
