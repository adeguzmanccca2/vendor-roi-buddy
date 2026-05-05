import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import PortalLayout from './PortalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';

const nameSchema = z.string().trim().min(2).max(100);
const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only');

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

export default function DealershipEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [status, setStatus] = useState('active');

  useEffect(() => {
    if (!id) return;
    supabase
      .from('organizations')
      .select('name, slug, status')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error('Dealership not found');
          navigate('/admin/portal/dealerships');
          return;
        }
        setName(data.name);
        setSlug(data.slug);
        setStatus(data.status);
        setLoading(false);
      });
  }, [id]);

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = nameSchema.safeParse(name);
    const s = slugSchema.safeParse(slug);
    if (!n.success) return toast.error('Invalid name (2–100 chars)');
    if (!s.success) return toast.error(s.error.errors[0].message);

    setBusy(true);
    const { error } = await supabase
      .from('organizations')
      .update({ name: n.data, slug: s.data, status })
      .eq('id', id!);
    setBusy(false);
    if (error) {
      toast.error(error.message.includes('duplicate') ? 'Slug already in use' : error.message);
      return;
    }
    toast.success('Dealership updated');
    navigate('/admin/portal/dealerships');
  };

  if (loading) {
    return (
      <PortalLayout>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="max-w-xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/portal/dealerships')}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to list
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit Dealership</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="e-name">Name</Label>
                <Input
                  id="e-name"
                  value={name}
                  onChange={e => onNameChange(e.target.value)}
                  placeholder="Smith Ford of Dallas"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-slug">Slug</Label>
                <Input
                  id="e-slug"
                  value={slug}
                  onChange={e => { setSlug(e.target.value.toLowerCase()); setSlugTouched(true); }}
                  placeholder="smith-ford-dallas"
                />
                <p className="text-xs text-muted-foreground">Lowercase letters, numbers, hyphens.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="e-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</Button>
                <Button type="button" variant="outline" onClick={() => navigate('/admin/portal/dealerships')}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
}
