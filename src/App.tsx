import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "@/context/AppContext";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/components/LoginPage";
import Index from "./pages/Index";
import VendorsPage from "./pages/Vendors";

import SalesPage from "./pages/Sales";
import MatchingPage from "./pages/Matching";
import VendorLeadsPage from "./pages/VendorLeads";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('vendor-roi-auth') === 'true');

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  return (
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
                
                <Route path="/sales" element={<SalesPage />} />
                <Route path="/matching" element={<MatchingPage />} />
                <Route path="/vendor-leads" element={<VendorLeadsPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          </BrowserRouter>
        </AppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
