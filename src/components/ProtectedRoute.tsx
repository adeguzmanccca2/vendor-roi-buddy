import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, AppRole } from '@/hooks/useAuth';

interface Props {
  children: ReactNode;
  requireRole?: AppRole;
}

export default function ProtectedRoute({ children, requireRole }: Props) {
  const { user, roles, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (requireRole && !roles.includes(requireRole)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
