import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useFollowUps, useReviews } from '../api/hooks';
import { Icon, type IconName } from './Icon';

const NAV: Array<{ to: string; label: string; icon: IconName; badge?: 'attention' }> = [
  { to: '/', label: 'Applications', icon: 'list' },
  { to: '/follow-ups', label: 'Follow-ups', icon: 'bell', badge: 'attention' },
  { to: '/add', label: 'Add', icon: 'plus' },
  { to: '/board', label: 'Board', icon: 'board' },
  { to: '/settings', label: 'Settings', icon: 'user' },
];

function useAttentionCount(): number {
  const followUps = useFollowUps();
  const reviews = useReviews();
  return (followUps.data?.followUps.length ?? 0) + (reviews.data?.length ?? 0);
}

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="absolute -top-1 left-1/2 ml-1.5 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[10px] leading-4 font-semibold text-white md:static md:ml-auto">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Mobile: content + fixed bottom tab bar. md+: left sidebar. */
export function Layout() {
  const attention = useAttentionCount();

  return (
    <div className="min-h-dvh md:flex">
      <nav className="hidden w-56 shrink-0 border-r border-slate-200 p-3 md:block dark:border-slate-800">
        <div className="px-3 py-2 text-lg font-semibold">Job Tracker</div>
        <ul className="mt-2 space-y-1">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900'
                  }`
                }
              >
                <Icon name={item.icon} />
                {item.label}
                {item.badge && <Badge count={attention} />}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-950/95">
        <ul className="grid grid-cols-5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                    isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                  }`
                }
              >
                {item.to === '/add' ? (
                  <span className="-mt-1 rounded-full bg-slate-900 p-1.5 text-white dark:bg-slate-100 dark:text-slate-900">
                    <Icon name="plus" />
                  </span>
                ) : (
                  <Icon name={item.icon} />
                )}
                {item.label}
                {item.badge && <Badge count={attention} />}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Sticky page header used by every screen. */
export function PageHeader({ title, back, actions, children }: { title: ReactNode; back?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        {back}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
        {actions}
      </div>
      {children && <div className="mx-auto max-w-3xl px-4 pb-3">{children}</div>}
    </header>
  );
}
