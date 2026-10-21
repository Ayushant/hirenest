import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { AppRole } from '../types/db';
import { Skeleton } from '../components/ui/kit';

interface RequireRoleProps {
  allowedRoles: AppRole[];
  children: React.ReactNode;
}

export const RequireRole: React.FC<RequireRoleProps> = ({ allowedRoles, children }) => {
  const { session, profile, organization, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/signin?returnTo=${returnTo}`} replace />;
  }

  if (!profile) {
    return <Navigate to="/pending" replace />;
  }

  // Section 4.2: status = 'pending_approval' or role = 'pending' -> Pending approval page
  if (profile.status === 'pending_approval' || profile.role === 'pending') {
    if (location.pathname !== '/pending') {
      return <Navigate to="/pending" replace />;
    }
    return <>{children}</>;
  }

  // Section 4.2: status = 'suspended' or org not approved -> Access suspended page
  const orgNotApproved =
    organization !== null &&
    profile.role !== 'admin' &&
    profile.role !== 'recruiter' &&
    organization.status !== 'approved';

  if (profile.status === 'suspended' || orgNotApproved) {
    if (location.pathname !== '/suspended') {
      return <Navigate to="/suspended" replace />;
    }
    return <>{children}</>;
  }

  if (!allowedRoles.includes(profile.role)) {
    const fallback =
      profile.role === 'admin'
        ? '/admin'
        : profile.role === 'recruiter'
          ? '/recruiter'
          : profile.role === 'client_manager' || profile.role === 'client_member'
            ? '/client'
            : profile.role === 'vendor_admin' || profile.role === 'vendor_recruiter'
              ? '/vendor'
              : '/candidate';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
};
