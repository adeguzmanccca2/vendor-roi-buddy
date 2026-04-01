import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "@/context/AppContext";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index";
import VendorsPage from "./pages/Vendors";
import LeadsPage from "./pages/Leads";
import SalesPage from "./pages/Sales";
import MatchingPage from "./pages/Matching";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppProvider>
        <BrowserRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/vendors" element={<VendorsPage />} />
              <Route path="/leads" element={<LeadsPage />} />
              <Route path="/sales" element={<SalesPage />} />
              <Route path="/matching" element={<MatchingPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppLayout>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
