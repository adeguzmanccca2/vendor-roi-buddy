import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import PortalLayout from './PortalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export default function DealershipNew() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = nameSchema.safeParse(name);
    const s = slugSchema.safeParse(slug);
    if (!n.success) return toast.error('Invalid name (2–100 chars)');
    if (!s.success) return toast.error(s.error.errors[0].message);

    setBusy(true);
    const { error } = await supabase.from('organizations').insert({ name: n.data, slug: s.data });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes('duplicate') ? 'Slug already exists' : error.message);
      return;
    }
    toast.success('Dealership created');
    navigate('/admin/portal/dealerships');
  };

  return (
    <PortalLayout>
      <div className="max-w-xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/portal/dealerships')}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to list
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Dealership</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="d-name">Name</Label>
                <Input
                  id="d-name"
                  value={name}
                  onChange={e => onNameChange(e.target.value)}
                  placeholder="Smith Ford of Dallas"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-slug">Slug</Label>
                <Input
                  id="d-slug"
                  value={slug}
                  onChange={e => { setSlug(e.target.value.toLowerCase()); setSlugTouched(true); }}
                  placeholder="smith-ford-dallas"
                />
                <p className="text-xs text-muted-foreground">
                  Used in URLs. Lowercase letters, numbers, hyphens.
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Creating...' : 'Create Dealership'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/admin/portal/dealerships')}
                >
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
