// src/App.tsx

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { ThemeProvider } from "./contexts/ThemeContext";
import AdminLayout from "./layouts/AdminLayout";
import LoginPage from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import LabourPage from "./pages/Labour";
import ProcessorPage from "./pages/Processor";
import DispatchesPage from "./pages/Dispatches";
import DispatchDetailsPage from "./pages/DispatchDetails";
import OwnerStockPage from "./pages/OwnerStock";
import CompanyStockPage from "./pages/CompanyStock";
import GroupBillsPage from "./pages/GroupBills";
import GroupDrawingsPage from "./pages/GroupDrawings";
import FoldersPage from "./pages/Folders";
import FolderDetailPage from "./pages/FolderDetail";
import PlaceholderPage from "./pages/Placeholder";
import JobsLabourPage from "./pages/JobsLabour";
import JobsWithMaterialPage from "./pages/JobsWithMaterial";
import JobImportPage from "./pages/JobImport";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected admin routes */}
          <Route element={<AdminLayout />}>
            {/* Phase 1 — Dashboard */}
            <Route path="/" element={<DashboardPage />} />

            {/* Phase 2 — User Management & Dispatches */}
            <Route path="/labour" element={<LabourPage />} />
            <Route path="/processor" element={<ProcessorPage />} />
            <Route path="/dispatches" element={<DispatchesPage />} />
            <Route path="/dispatches/:id" element={<DispatchDetailsPage />} />

            {/* Jobs */}
            <Route path="/jobs/labour" element={<JobsLabourPage />} />
            <Route path="/jobs/with-material" element={<JobsWithMaterialPage />} />
            <Route path="/jobs/import" element={<JobImportPage />} />

            {/* Phase 3 — Inventory */}
            <Route path="/stock-owner" element={<OwnerStockPage />} />
            <Route path="/stock-company" element={<CompanyStockPage />} />

            {/* Phase 4 — Documents */}
            <Route path="/group-bills" element={<GroupBillsPage />} />
            <Route path="/group-drawings" element={<GroupDrawingsPage />} />

            {/* Phase 5 — Organization */}
            <Route path="/folders" element={<FoldersPage />} />
            <Route path="/folders/:id" element={<FolderDetailPage />} />

            {/* Settings */}
            <Route path="/settings" element={<PlaceholderPage />} />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
