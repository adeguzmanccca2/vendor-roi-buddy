import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/hooks/useAuth';
import ProtectedRoute from '@/components/ProtectedRoute';
import AppLayout from '@/components/AppLayout';
import RoleRouter from '@/components/RoleRouter';
import AuthPage from '@/pages/Auth';
import AdminOverview from '@/pages/admin/AdminOverview';
import AdminDealerships from '@/pages/admin/AdminDealerships';
import AdminUsers from '@/pages/admin/AdminUsers';
import NotFound from '@/pages/NotFound';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout><RoleRouter /></AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin"
              element={
                <ProtectedRoute requireRole="admin">
                  <AppLayout><AdminOverview /></AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/dealerships"
              element={
                <ProtectedRoute requireRole="admin">
                  <AppLayout><AdminDealerships /></AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute requireRole="admin">
                  <AppLayout><AdminUsers /></AppLayout>
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
