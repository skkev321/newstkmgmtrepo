import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import supabaseClient from './supabaseClient';
import Layout from './components/Layout';

// Components
import AddBundleTypeForm from './components/AddBundleTypeForm';
import RecordBorrowingForm from './components/RecordBorrowingForm';
import RecordSaleForm from './components/RecordSaleForm';
import ViewStock from './components/ViewStock';
import ViewSales from './components/ViewSales';
import PendingPayments from './components/PendingPayments';
import ViewBorrowing from './components/ViewBorrowing';
import ViewAnalytics from './components/ViewAnalytics';

import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './components/LoginPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ViewAnalytics supabaseClient={supabaseClient} />} />
            <Route path="record-sale" element={<RecordSaleForm supabaseClient={supabaseClient} />} />
            <Route path="record-borrowing" element={<RecordBorrowingForm supabaseClient={supabaseClient} />} />
            <Route path="pending-payments" element={<PendingPayments supabaseClient={supabaseClient} />} />
            <Route path="stock" element={<ViewStock supabaseClient={supabaseClient} />} />
            <Route path="sales" element={<ViewSales supabaseClient={supabaseClient} />} />
            <Route path="bundles" element={<AddBundleTypeForm supabaseClient={supabaseClient} />} />
            <Route path="borrowings" element={<ViewBorrowing supabaseClient={supabaseClient} />} />
            {/* Fallback to dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
