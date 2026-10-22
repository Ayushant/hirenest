import React, { useState, useEffect, useRef } from 'react';
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
import { Avatar } from '../components/ui/kit';
import type { AppRole } from '../types/db';

interface NavItem {
  label: string;
  to: string;
  icon: React.FC<{ className?: string; strokeWidth?: number }>;
  badgeCount?: number;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, organization, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return document.documentElement.classList.contains('dark');
  });

  const role: AppRole = profile?.role || 'pending';
  const isHq = role === 'admin' || role === 'recruiter';
  const isClient = role === 'client_manager' || role === 'client_member';
  const isCandidate = role === 'candidate';

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Keyboard shortcuts: Cmd/Ctrl+J for Assistant (non-candidates), Cmd/Ctrl+K for global search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        if (!isCandidate) {
          e.preventDefault();
          setAiDrawerOpen((prev) => !prev);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCandidate]);

  // Notifications query
  const { data: notifData } = useQuery({
    queryKey: ['notifications', profile?.id],
    queryFn: () => fetchNotifications({ page: 1, pageSize: 15 }),
    enabled: Boolean(profile?.id),
  });

  // Platform settings
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

  const getNavGroups = (): NavGroup[] => {
    const basePrefix = role === 'admin' ? '/admin' : '/recruiter';

    if (role === 'admin' || role === 'recruiter') {
      const pipelineGroup: NavGroup = {
        title: 'Pipeline',
        items: [
          { label: 'Dashboard', to: `${basePrefix}`, icon: LayoutDashboard },
          { label: 'Requirements', to: `${basePrefix}/requirements`, icon: Briefcase },
          { label: 'Candidates', to: `${basePrefix}/candidates`, icon: Users },
          { label: 'Submissions', to: `${basePrefix}/submissions`, icon: GitPullRequest },
          {
            label: 'Interviews',
            to: `${basePrefix}/interviews`,
            icon: Calendar,
            badgeCount: pendingFeedbackCount || undefined,
          },
          { label: 'Duplicates & ownership', to: `${basePrefix}/duplicates`, icon: Flag },
          { label: 'Vendor performance', to: `${basePrefix}/vendor-performance`, icon: BarChart3 },
        ],
      };

      if (role === 'admin') {
        const govGroup: NavGroup = {
          title: 'Governance',
          items: [
            { label: 'Approvals', to: '/admin/approvals', icon: UserCheck },
            { label: 'Organizations', to: '/admin/organizations', icon: Building2 },
            { label: 'Users', to: '/admin/users', icon: Users },
            { label: 'Feedback moderation', to: '/admin/feedback-moderation', icon: ClipboardCheck },
            { label: 'Disputes', to: '/admin/disputes', icon: Scale },
            { label: 'Settings & weights', to: '/admin/settings', icon: Settings },
            { label: 'Audit log', to: '/admin/audit-logs', icon: ShieldCheck },
          ],
        };
        return [pipelineGroup, govGroup];
      }
      return [{ items: pipelineGroup.items }];
    }

    if (role === 'client_manager' || role === 'client_member') {
      const items: NavItem[] = [
        { label: 'Dashboard', to: '/client', icon: LayoutDashboard },
        { label: 'Requirements', to: '/client/requirements', icon: Briefcase },
        { label: 'Candidates for review', to: '/client/candidates', icon: Users },
        {
          label: 'Interviews & feedback',
          to: '/client/interviews',
          icon: Calendar,
          badgeCount: pendingFeedbackCount || undefined,
        },
      ];
      if (platformSettings?.share_vendor_summary_with_clients) {
        items.push({
          label: 'Vendor summary',
          to: '/client/vendors',
          icon: BarChart3,
        });
      }
      return [{ items }];
    }

    if (role === 'vendor_admin' || role === 'vendor_recruiter') {
      return [
        {
          items: [
            { label: 'Dashboard', to: '/vendor', icon: LayoutDashboard },
            { label: 'Shared requirements', to: '/vendor/requirements', icon: Briefcase },
            { label: 'Candidate pool', to: '/vendor/candidates', icon: Users },
            { label: 'My submissions', to: '/vendor/submissions', icon: GitPullRequest },
            { label: 'Ratings & performance', to: '/vendor/performance', icon: BarChart3 },
          ],
        },
      ];
    }

    if (role === 'candidate') {
      return [
        {
          items: [
            { label: 'Jobs for me', to: '/candidate', icon: Briefcase },
            { label: 'Browse open jobs', to: '/candidate/browse', icon: FileSearch },
            { label: 'My applications', to: '/candidate/applications', icon: GitPullRequest },
            { label: 'My profile', to: '/candidate/profile', icon: UserCheck },
          ],
        },
      ];
    }

    return [];
  };

  const navGroups = getNavGroups();
  const firstLink = navGroups[0]?.items[0]?.to || '/';

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

  const pathSegments = location.pathname.split('/').filter(Boolean);

  return (
    <div className="min-h-screen flex bg-[var(--app-bg)] text-[var(--text-primary)]">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar: 240px wide, storm-slate deep #1E2A36 (#0A1016 in dark) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[240px] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] flex flex-col transition-transform duration-150 ease-out lg:static lg:translate-x-0 shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Wordmark: "HireNest" in 14/600 white with small rich-blue square mark carrying a sky #88BDF2 dot */}
        <div className="h-[52px] px-4 flex items-center justify-between border-b border-white/10">
          <Link to={firstLink} className="min-w-0 flex items-center gap-2.5">
            <span className="h-6 w-6 rounded-[6px] bg-[#1F4CC4] flex items-center justify-center shrink-0">
              <span className="h-2 w-2 rounded-full bg-[#88BDF2]" />
            </span>
            <div className="min-w-0 flex flex-col">
              <span className="text-[14px] leading-[18px] font-semibold text-white truncate">
                HireNest
              </span>
              {organization?.name && (
                <span className="text-[11px] leading-[14px] text-[var(--sidebar-muted)] truncate">
                  {organization.name}
                </span>
              )}
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
            className="lg:hidden text-[var(--sidebar-muted)] hover:text-white p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Role-Scoped Navigation: 34px tall items, 13px, 16px stroke icons, 2px sky #88BDF2 left bar when active */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
          {navGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-0.5">
              {group.title && navGroups.length > 1 && (
                <div className="px-2.5 pb-1 text-[11px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--sidebar-muted)]">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => {
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
                      `relative h-[34px] px-2.5 rounded-[6px] flex items-center justify-between gap-2 text-[13px] leading-[20px] transition-colors duration-120 ${
                        isActive
                          ? 'bg-[var(--sidebar-active)] text-white font-medium'
                          : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-white font-normal'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[#88BDF2]" />
                        )}
                        <span className="flex items-center gap-2.5 truncate">
                          <Icon
                            strokeWidth={1.75}
                            className={`h-4 w-4 shrink-0 ${
                              isActive ? 'text-[#88BDF2]' : 'text-[var(--sidebar-muted)]'
                            }`}
                          />
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.badgeCount !== undefined && item.badgeCount > 0 && (
                          <span className="rounded-[6px] bg-[#88BDF2]/20 px-1.5 py-0.5 font-mono tabular-nums text-[11px] leading-[14px] text-[#88BDF2] font-medium">
                            {item.badgeCount}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom User Card */}
        <div className="border-t border-white/10 p-2.5 space-y-1.5">
          <div className="px-2 py-1.5 flex items-center gap-2.5">
            <Avatar id={profile?.id} name={profile?.full_name} size="md" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-[18px] font-medium text-white truncate">
                {profile?.full_name}
              </div>
              <div className="text-[12px] leading-[16px] text-[var(--sidebar-muted)] truncate">
                {ROLE_LABELS[role]}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="w-full h-[34px] px-2.5 rounded-[6px] flex items-center gap-2 text-[13px] leading-[20px] text-[var(--sidebar-muted)] hover:text-white hover:bg-[var(--sidebar-hover)] transition-colors cursor-pointer"
          >
            <LogOut strokeWidth={1.75} className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area: Storm 50 canvas */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--app-bg)]">
        {/* Top Bar: 52px tall, white surface, 1px bottom border */}
        <header className="h-[52px] border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden h-8 w-8 inline-flex items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <Menu strokeWidth={1.75} className="h-4 w-4" />
            </button>

            {/* Breadcrumbs: Section / Page */}
            <div className="flex items-center gap-1.5 text-[13px] leading-[20px] text-[var(--text-secondary)] truncate">
              {pathSegments.map((seg, i) => (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <ChevronRight
                      strokeWidth={1.75}
                      className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
                    />
                  )}
                  <span
                    className={`capitalize truncate max-w-[180px] ${
                      i === pathSegments.length - 1
                        ? 'font-medium text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {seg.replace(/-/g, ' ')}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Right: Search (⌘K), Assistant button with sky dot, notifications, theme toggle, user avatar */}
          <div className="flex items-center gap-2 shrink-0">
            <form onSubmit={handleGlobalSearch} className="relative hidden md:block w-60">
              <Search
                strokeWidth={1.75}
                className="h-3.5 w-3.5 text-[var(--text-tertiary)] absolute left-2.5 top-1/2 -translate-y-1/2"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder={isCandidate ? 'Search open jobs...' : 'Search requirements...'}
                className="w-full h-[34px] rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] pl-8 pr-10 text-[13px] leading-[20px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--focus-border)] focus:ring-[3px] focus:ring-[var(--focus-ring)] focus:bg-[var(--surface)]"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] leading-[16px] text-[var(--text-tertiary)]">
                ⌘K
              </kbd>
            </form>

            {!isCandidate && (
              <button
                type="button"
                onClick={() => setAiDrawerOpen(true)}
                className="h-8 px-2.5 rounded-[6px] inline-flex items-center gap-1.5 text-[13px] leading-[20px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              >
                <span className="h-2 w-2 rounded-full bg-[#88BDF2] shrink-0" />
                <span>Assistant</span>
                <kbd className="hidden sm:inline font-mono text-[11px] leading-[16px] text-[var(--text-tertiary)]">
                  ⌘J
                </kbd>
              </button>
            )}

            {/* Notifications Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((prev) => !prev)}
                aria-label="Notifications"
                className="relative h-8 w-8 inline-flex items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                <Bell strokeWidth={1.75} className="h-4 w-4" />
                {(notifData?.unreadCount || 0) > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[var(--marker-new)]" />
                )}
              </button>

              {notifOpen && (
                <div
                  style={{ boxShadow: 'var(--shadow-floating)' }}
                  className="absolute right-0 mt-1.5 w-80 sm:w-96 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] z-50 overflow-hidden"
                >
                  <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--drawer-header-bg)] px-4 py-2.5">
                    <span className="text-[12px] leading-[16px] font-medium text-[var(--text-primary)]">
                      Notifications ·{' '}
                      <span className="font-mono tabular-nums">{notifData?.unreadCount || 0}</span>{' '}
                      unread
                    </span>
                    {(notifData?.unreadCount || 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => markAllMutation.mutate()}
                        className="inline-flex items-center gap-1 text-[12px] leading-[16px] text-[var(--accent)] hover:underline cursor-pointer"
                      >
                        <CheckCheck strokeWidth={1.75} className="h-3.5 w-3.5" />
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border)]">
                    {!notifData?.data?.length ? (
                      <div className="p-4 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                        No notifications.
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
                          className={`px-4 py-3 text-[13px] leading-[20px] cursor-pointer hover:bg-[var(--bg-hover)] transition-colors ${
                            !n.read_at ? 'bg-[var(--drawer-header-bg)]' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                              {!n.read_at && (
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--marker-new)] shrink-0" />
                              )}
                              {n.title}
                            </span>
                            <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)] shrink-0">
                              {formatRelativeTime(n.created_at)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                            {n.body}
                          </p>
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
              className="h-8 w-8 inline-flex items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              {darkMode ? (
                <Sun strokeWidth={1.75} className="h-4 w-4" />
              ) : (
                <Moon strokeWidth={1.75} className="h-4 w-4" />
              )}
            </button>

            <Avatar id={profile?.id} name={profile?.full_name} size="sm" />
          </div>
        </header>

        {/* Persistent Feedback Pending Banner for Client & HQ */}
        {pendingFeedbackCount > 0 && (isClient || isHq) && (
          <div className="bg-[var(--status-warning-bg)] border-b border-[var(--border)] px-4 sm:px-8 py-2 flex items-center justify-between text-[13px] leading-[20px]">
            <span className="text-[var(--status-warning)] flex items-center gap-2 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-warning-dot)] shrink-0" />
              <span>
                Feedback pending:{' '}
                <span className="font-mono tabular-nums font-semibold">{pendingFeedbackCount}</span>{' '}
                completed interview{pendingFeedbackCount > 1 ? 's' : ''} awaiting structured
                feedback.
              </span>
            </span>
            <Link
              to={isClient ? '/client/interviews' : `/${role}/interviews`}
              className="font-medium text-[var(--status-warning)] underline hover:no-underline"
            >
              Submit feedback →
            </Link>
          </div>
        )}

        {/* Content canvas: max-width 1320px, 24px 32px padding */}
        <main className="flex-1 py-6 px-4 sm:px-8 max-w-[1320px] w-full mx-auto space-y-6">
          {children}
        </main>
      </div>

      {/* General Staffing Help Assistant Drawer (non-candidate roles only) */}
      {!isCandidate && (
        <AiAssistantDrawer open={aiDrawerOpen} onClose={() => setAiDrawerOpen(false)} />
      )}
    </div>
  );
};
