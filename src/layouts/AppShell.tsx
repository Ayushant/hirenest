import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  FileSearch,
  Flag,
  GitPullRequest,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  UserCheck,
  Users,
  X,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications';
import { fetchPlatformSettings } from '../api/admin';
import { fetchMyPendingFeedback } from '../api/interviews';
import { ROLE_LABELS, formatRelativeTime } from '../lib/format';
import { AiAssistantDrawer } from '../components/domain/AiAssistantDrawer';
import type { AppRole } from '../types/db';

interface NavItem {
  label: string;
  to: string;
  icon: React.FC<{ className?: string }>;
  badgeCount?: number;
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, organization, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const role: AppRole = profile?.role || 'pending';
  const isHq = role === 'admin' || role === 'recruiter';
  const isClient = role === 'client_manager' || role === 'client_member';
  const isCandidate = role === 'candidate';

  // Notifications query
  const { data: notifData } = useQuery({
    queryKey: ['notifications', profile?.id],
    queryFn: () => fetchNotifications({ page: 1, pageSize: 15 }),
    enabled: Boolean(profile?.id),
  });

  // Platform settings (to check if client vendor summary is enabled)
  const { data: platformSettings } = useQuery({
    queryKey: ['platform_settings'],
    queryFn: fetchPlatformSettings,
    enabled: Boolean(profile?.id),
  });

  // Pending interview feedback count for Client and HQ
  const { data: pendingFeedbackList } = useQuery({
    queryKey: ['my_pending_feedback', profile?.id],
    queryFn: fetchMyPendingFeedback,
    enabled: Boolean(profile?.id && (isHq || isClient)),
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(profile!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const pendingFeedbackCount = pendingFeedbackList?.length || 0;

  const getNavItems = (): NavItem[] => {
    const basePrefix = role === 'admin' ? '/admin' : '/recruiter';

    if (role === 'admin' || role === 'recruiter') {
      const items: NavItem[] = [
        { label: 'Dashboard', to: `${basePrefix}`, icon: LayoutDashboard },
        { label: 'Requirements', to: `${basePrefix}/requirements`, icon: Briefcase },
        { label: 'Candidates (360)', to: `${basePrefix}/candidates`, icon: Users },
        { label: 'Submissions', to: `${basePrefix}/submissions`, icon: GitPullRequest },
        {
          label: 'Interviews',
          to: `${basePrefix}/interviews`,
          icon: Calendar,
          badgeCount: pendingFeedbackCount || undefined,
        },
        { label: 'Duplicates & Ownership', to: `${basePrefix}/duplicates`, icon: Flag },
        { label: 'Vendor Performance', to: `${basePrefix}/vendor-performance`, icon: BarChart3 },
      ];

      if (role === 'admin') {
        items.push(
          { label: 'Approvals', to: '/admin/approvals', icon: UserCheck },
          { label: 'Organizations', to: '/admin/organizations', icon: Building2 },
          { label: 'Users', to: '/admin/users', icon: Users },
          { label: 'Feedback Moderation', to: '/admin/feedback-moderation', icon: ClipboardCheck },
          { label: 'Disputes', to: '/admin/disputes', icon: Scale },
          { label: 'Settings & Weights', to: '/admin/settings', icon: Settings },
          { label: 'Audit Log', to: '/admin/audit-logs', icon: ShieldCheck }
        );
      }
      return items;
    }

    if (role === 'client_manager' || role === 'client_member') {
      const items: NavItem[] = [
        { label: 'Dashboard', to: '/client', icon: LayoutDashboard },
        { label: 'Requirements', to: '/client/requirements', icon: Briefcase },
        { label: 'Candidates for Review', to: '/client/candidates', icon: Users },
        {
          label: 'Interviews & Feedback',
          to: '/client/interviews',
          icon: Calendar,
          badgeCount: pendingFeedbackCount || undefined,
        },
      ];
      if (platformSettings?.share_vendor_summary_with_clients) {
        items.push({
          label: 'Vendor Summary',
          to: '/client/vendors',
          icon: BarChart3,
        });
      }
      return items;
    }

    if (role === 'vendor_admin' || role === 'vendor_recruiter') {
      return [
        { label: 'Dashboard', to: '/vendor', icon: LayoutDashboard },
        { label: 'Shared Requirements', to: '/vendor/requirements', icon: Briefcase },
        { label: 'Candidate Pool', to: '/vendor/candidates', icon: Users },
        { label: 'My Submissions', to: '/vendor/submissions', icon: GitPullRequest },
        { label: 'Ratings & Performance', to: '/vendor/performance', icon: BarChart3 },
      ];
    }

    if (role === 'candidate') {
      return [
        { label: 'Jobs for Me', to: '/candidate', icon: Briefcase },
        { label: 'Browse All Open Jobs', to: '/candidate/browse', icon: FileSearch },
        { label: 'My Applications', to: '/candidate/applications', icon: GitPullRequest },
        { label: 'My Profile', to: '/candidate/profile', icon: UserCheck },
      ];
    }

    return [];
  };

  const navItems = getNavItems();

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = globalSearch.trim();
    if (!q) return;
    if (role === 'admin') {
      navigate(`/admin/requirements?search=${encodeURIComponent(q)}`);
    } else if (role === 'recruiter') {
      navigate(`/recruiter/requirements?search=${encodeURIComponent(q)}`);
    } else if (isClient) {
      navigate(`/client/requirements?search=${encodeURIComponent(q)}`);
    } else if (role === 'vendor_admin' || role === 'vendor_recruiter') {
      navigate(`/vendor/requirements?search=${encodeURIComponent(q)}`);
    } else if (role === 'candidate') {
      navigate(`/candidate/browse?search=${encodeURIComponent(q)}`);
    }
  };

  // Breadcrumb generation for detail pages
  const pathSegments = location.pathname.split('/').filter(Boolean);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <Link
            to={navItems[0]?.to || '/'}
            className="text-base font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-indigo-600 text-white text-xs font-bold">
              H
            </span>
            <span>HireNestOS</span>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
            className="lg:hidden text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Workspace & Org Context Header */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {ROLE_LABELS[role]}
          </div>
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
            {organization?.name || (isHq ? 'HireNest Workforce HQ' : 'Direct Candidate Portal')}
          </div>
        </div>

        {/* Role-Scoped Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={
                  item.to === '/admin' ||
                  item.to === '/recruiter' ||
                  item.to === '/client' ||
                  item.to === '/vendor' ||
                  item.to === '/candidate'
                }
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                  }`
                }
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-mono tabular-nums font-semibold text-white">
                    {item.badgeCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom Profile & Sign Out */}
        <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="px-2 py-1">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {profile?.full_name}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {profile?.email}
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* Breadcrumbs */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
              {pathSegments.map((seg, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  <span
                    className={`capitalize truncate max-w-[160px] ${
                      i === pathSegments.length - 1
                        ? 'font-medium text-slate-900 dark:text-slate-100'
                        : ''
                    }`}
                  >
                    {seg.replace(/-/g, ' ')}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Scoped Search + Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            <form onSubmit={handleGlobalSearch} className="relative hidden md:block w-60">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder={isCandidate ? 'Search open jobs...' : 'Search requirements...'}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </form>

            {/* Guardrail 1: Never show AI drawer on candidate-facing screens */}
            {!isCandidate && (
              <button
                type="button"
                onClick={() => setAiDrawerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                <span className="hidden sm:inline">AI Guide</span>
              </button>
            )}

            {/* Notifications Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((prev) => !prev)}
                aria-label="Notifications"
                className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Bell className="h-4 w-4" />
                {(notifData?.unreadCount || 0) > 0 && (
                  <span className="absolute -top-1 -right-1 rounded-full bg-indigo-600 px-1.5 py-0.2 text-[10px] font-mono tabular-nums font-bold text-white">
                    {notifData?.unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Notifications ({notifData?.unreadCount || 0} unread)
                    </span>
                    {(notifData?.unreadCount || 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => markAllMutation.mutate()}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {!notifData?.data?.length ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No notifications yet.
                      </div>
                    ) : (
                      notifData.data.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            if (!n.read_at) markReadMutation.mutate(n.id);
                            setNotifOpen(false);
                            if (n.link) navigate(n.link);
                          }}
                          className={`p-3.5 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${
                            !n.read_at ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {n.title}
                            </span>
                            <span className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0">
                              {formatRelativeTime(n.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-600 dark:text-slate-400">{n.body}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle color theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Persistent Feedback Pending Banner for Client & HQ (Section 6.2 & 8.1) */}
        {pendingFeedbackCount > 0 && (isClient || isHq) && (
          <div className="bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900/60 px-6 py-2.5 flex items-center justify-between text-xs">
            <span className="font-medium text-red-800 dark:text-red-200">
              Feedback pending: You have {pendingFeedbackCount} completed interview
              {pendingFeedbackCount > 1 ? 's' : ''} awaiting mandatory structured feedback.
            </span>
            <Link
              to={isClient ? '/client/interviews' : `/${role}/interviews`}
              className="font-semibold text-red-700 dark:text-red-300 underline hover:no-underline"
            >
              Submit Feedback Now →
            </Link>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto space-y-6">
          {children}
        </main>
      </div>

      {/* General Staffing Help AI Drawer (non-candidate roles only) */}
      {!isCandidate && (
        <AiAssistantDrawer open={aiDrawerOpen} onClose={() => setAiDrawerOpen(false)} />
      )}
    </div>
  );
};
