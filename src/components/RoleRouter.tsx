import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import ClientDashboard from '@/pages/ClientDashboard';

/**
 * Root route ("/") behavior:
 * - Admins land on /admin
 * - Clients see their dashboard
 */
export default function RoleRouter() {
  const { isAdmin } = useAuth();
  if (isAdmin) return <Navigate to="/admin" replace />;
  return <ClientDashboard />;
}
