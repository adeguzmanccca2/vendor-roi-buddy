import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/hooks/useAuth';
import { ActiveOrgProvider } from '@/hooks/useActiveOrg';
import ProtectedRoute from '@/components/ProtectedRoute';
import AppLayout from '@/components/AppLayout';
import RoleRouter from '@/components/RoleRouter';
import AuthPage from '@/pages/Auth';
import VendorsPage from '@/pages/Vendors';
import LeadsPage from '@/pages/Leads';
import UploadPage from '@/pages/Upload';
import SalesUploadPage from '@/pages/SalesUpload';
import SalesPage from '@/pages/Sales';
import AttributionPage from '@/pages/Attribution';
import SourceRulesPage from '@/pages/SourceRules';
import InventoryPage from '@/pages/Inventory';
import InventoryUploadPage from '@/pages/InventoryUpload';
import AdminOverview from '@/pages/admin/AdminOverview';
import AdminUsers from '@/pages/admin/AdminUsers';
import PortalOverview from '@/pages/admin/portal/PortalOverview';
import DealershipsList from '@/pages/admin/portal/DealershipsList';
import DealershipNew from '@/pages/admin/portal/DealershipNew';
import NotFound from '@/pages/NotFound';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ActiveOrgProvider>
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
                path="/vendors"
                element={
                  <ProtectedRoute>
                    <AppLayout><VendorsPage /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/leads"
                element={
                  <ProtectedRoute>
                    <AppLayout><LeadsPage /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/upload"
                element={
                  <ProtectedRoute>
                    <AppLayout><UploadPage /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sales"
                element={
                  <ProtectedRoute>
                    <AppLayout><SalesPage /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sales/upload"
                element={
                  <ProtectedRoute>
                    <AppLayout><SalesUploadPage /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/attribution"
                element={
                  <ProtectedRoute>
                    <AppLayout><AttributionPage /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/source-rules"
                element={
                  <ProtectedRoute>
                    <AppLayout><SourceRulesPage /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inventory"
                element={
                  <ProtectedRoute>
                    <AppLayout><InventoryPage /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inventory/upload"
                element={
                  <ProtectedRoute>
                    <AppLayout><InventoryUploadPage /></AppLayout>
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
                path="/admin/portal"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AppLayout><PortalOverview /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/portal/dealerships"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AppLayout><DealershipsList /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/portal/dealerships/new"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AppLayout><DealershipNew /></AppLayout>
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
          </ActiveOrgProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
