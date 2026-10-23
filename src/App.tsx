import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireRole } from './auth/RequireRole';
import { ToastProvider } from './components/ui/Toast';
import { AppShell } from './layouts/AppShell';

import {
  SetupGuideScreen,
  SignInPage,
  SignUpPage,
  ForgotPasswordPage,
  UpdatePasswordPage,
  PendingApprovalPage,
  SuspendedAccessPage,
} from './pages/auth/AuthPages';

import {
  HqDashboardPage,
  AdminApprovalsPage,
  AdminOrganizationsPage,
  AdminOrganizationDetailPage,
  AdminUsersPage,
} from './pages/admin/HqDashboardAndGov';

import {
  HqRequirementsListPage,
  HqRequirementDetailPage,
} from './pages/admin/HqRequirementsPages';

import {
  HqCandidatesListPage,
  HqCandidateDetailPage,
  HqSubmissionsPage,
  HqInterviewsPage,
  HqDuplicatesPage,
} from './pages/admin/HqCandidatesAndPipelinePages';

import {
  HqVendorPerformancePage,
  AdminFeedbackModerationPage,
  AdminDisputesPage,
  AdminSettingsPage,
  AdminAuditLogsPage,
} from './pages/admin/HqRatingsAndSystemPages';

import {
  ClientDashboardPage,
  ClientRequirementsPage,
  ClientRequirementDetailPage,
  ClientCandidatesReviewPage,
  ClientInterviewsPage,
  ClientVendorSummaryPage,
} from './pages/client/ClientWorkspacePages';

import {
  VendorDashboardPage,
  VendorRequirementsPage,
  VendorRequirementDetailPage,
  VendorCandidatePoolPage,
  VendorCandidateDetailPage,
  VendorMatchIntelligencePage,
  VendorSubmissionsPage,
  VendorInterviewsPage,
  VendorRatingsPage,
} from './pages/vendor/VendorWorkspacePages';

import {
  CandidateJobsForMePage,
  CandidateBrowseJobsPage,
  CandidateApplicationsPage,
  CandidateProfilePage,
} from './pages/candidate/CandidateWorkspacePages';
import { SubscriptionPage } from './pages/subscription/SubscriptionPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RootRedirect() {
  const { session, loading, homeRoute } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-6">
        <div className="w-full max-w-[360px] space-y-3">
          <div className="h-4 w-24 rounded-[4px] bg-[var(--bg-hover)] animate-pulse" />
          <div className="h-3 w-48 rounded-[4px] bg-[var(--bg-subtle)] animate-pulse" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/signin" replace />;
  }

  return <Navigate to={homeRoute} replace />;
}

function AppRoutes() {
  const { isConfigured } = useAuth();

  if (!isConfigured) {
    return <SetupGuideScreen />;
  }

  return (
    <Routes>
      {/* Root Entry */}
      <Route path="/" element={<RootRedirect />} />

      {/* Public / Auth Screens */}
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<UpdatePasswordPage />} />
      <Route path="/pending" element={<PendingApprovalPage />} />
      <Route path="/suspended" element={<SuspendedAccessPage />} />

      {/* Admin Workspace (/admin/*) */}
      <Route
        path="/admin"
        element={
          <RequireRole allowedRoles={['admin']}>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireRole>
        }
      >
        <Route index element={<HqDashboardPage />} />
        <Route path="approvals" element={<AdminApprovalsPage />} />
        <Route path="organizations" element={<AdminOrganizationsPage />} />
        <Route path="organizations/:id" element={<AdminOrganizationDetailPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="requirements" element={<HqRequirementsListPage />} />
        <Route path="requirements/:id" element={<HqRequirementDetailPage />} />
        <Route path="candidates" element={<HqCandidatesListPage />} />
        <Route path="candidates/:id" element={<HqCandidateDetailPage />} />
        <Route path="submissions" element={<HqSubmissionsPage />} />
        <Route path="interviews" element={<HqInterviewsPage />} />
        <Route path="duplicates" element={<HqDuplicatesPage />} />
        <Route path="vendors" element={<HqVendorPerformancePage />} />
        <Route path="vendor-performance" element={<HqVendorPerformancePage />} />
        <Route path="feedback" element={<AdminFeedbackModerationPage />} />
        <Route path="feedback-moderation" element={<AdminFeedbackModerationPage />} />
        <Route path="disputes" element={<AdminDisputesPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="subscription" element={<SubscriptionPage />} />
        <Route path="audit-logs" element={<AdminAuditLogsPage />} />
      </Route>

      {/* Recruiter HQ Workspace (/recruiter/*) */}
      <Route
        path="/recruiter"
        element={
          <RequireRole allowedRoles={['recruiter', 'admin']}>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireRole>
        }
      >
        <Route index element={<HqDashboardPage />} />
        <Route path="requirements" element={<HqRequirementsListPage />} />
        <Route path="requirements/:id" element={<HqRequirementDetailPage />} />
        <Route path="candidates" element={<HqCandidatesListPage />} />
        <Route path="candidates/:id" element={<HqCandidateDetailPage />} />
        <Route path="submissions" element={<HqSubmissionsPage />} />
        <Route path="interviews" element={<HqInterviewsPage />} />
        <Route path="duplicates" element={<HqDuplicatesPage />} />
        <Route path="vendors" element={<HqVendorPerformancePage />} />
        <Route path="vendor-performance" element={<HqVendorPerformancePage />} />
        <Route path="subscription" element={<SubscriptionPage />} />
      </Route>

      {/* Client Workspace (/client/*) */}
      <Route
        path="/client"
        element={
          <RequireRole allowedRoles={['client_manager', 'client_member']}>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireRole>
        }
      >
        <Route index element={<ClientDashboardPage />} />
        <Route path="requirements" element={<ClientRequirementsPage />} />
        <Route path="requirements/:id" element={<ClientRequirementDetailPage />} />
        <Route path="candidates" element={<ClientCandidatesReviewPage />} />
        <Route path="interviews" element={<ClientInterviewsPage />} />
        <Route path="vendors" element={<ClientVendorSummaryPage />} />
        <Route path="subscription" element={<SubscriptionPage />} />
      </Route>

      {/* Vendor Workspace (/vendor/*) */}
      <Route
        path="/vendor"
        element={
          <RequireRole allowedRoles={['vendor_admin', 'vendor_recruiter']}>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireRole>
        }
      >
        <Route index element={<VendorDashboardPage />} />
        <Route path="requirements" element={<VendorRequirementsPage />} />
        <Route path="requirements/:id" element={<VendorRequirementDetailPage />} />
        <Route path="candidates" element={<VendorCandidatePoolPage />} />
        <Route path="candidates/:id" element={<VendorCandidateDetailPage />} />
        <Route path="matches" element={<VendorMatchIntelligencePage />} />
        <Route path="submissions" element={<VendorSubmissionsPage />} />
        <Route path="interviews" element={<VendorInterviewsPage />} />
        <Route path="ratings" element={<VendorRatingsPage />} />
        <Route path="performance" element={<VendorRatingsPage />} />
        <Route path="subscription" element={<SubscriptionPage />} />
      </Route>

      {/* Candidate Workspace (/candidate/*) */}
      <Route
        path="/candidate"
        element={
          <RequireRole allowedRoles={['candidate']}>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireRole>
        }
      >
        <Route index element={<CandidateJobsForMePage />} />
        <Route path="browse" element={<CandidateBrowseJobsPage />} />
        <Route path="applications" element={<CandidateApplicationsPage />} />
        <Route path="profile" element={<CandidateProfilePage />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
