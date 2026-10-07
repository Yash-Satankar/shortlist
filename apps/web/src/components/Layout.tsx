import { PRODUCT_NAME } from '@jt/shared';
import { Suspense, useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useStats } from '../api/hooks';
import { usePublicConfig } from '../auth/useAuth';
import { AskHost } from './AskSheet';
import { AppMark, Icon, type IconName } from './Icon';
import { Spinner, StatusGlyph } from './ui';

const NAV: Array<{ to: string; label: string; icon: IconName; attention?: boolean }> = [
  { to: '/', label: 'Applications', icon: 'list' },
  { to: '/follow-ups', label: 'Follow-ups', icon: 'inbox', attention: true },
  { to: '/add', label: 'Add', icon: 'plus' },
  { to: '/board', label: 'Board', icon: 'board' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
];

/** Everything the Follow-ups inbox will show (reviews + follow-ups + ghost suggestions), counted by the server. */
export function useAttention() {
  const needsYou = useStats().data?.needsYou;
  return { total: needsYou?.total ?? 0, reviews: needsYou?.reviews ?? 0, followUps: needsYou?.followUps ?? 0 };
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Mobile: content + fixed bottom nav (hidden on detail and quick-add, which have their own back/close).
 * md+: left sidebar, collapsing to a 64px rail on the Board so more columns fit.
 */
export function Layout() {
  const attention = useAttention();
  const { demo } = usePublicConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const onDetail = useMatch('/applications/:id');
  const onAdd = useMatch('/add');
  const onBoard = useMatch('/board');
  const hideBottomNav = Boolean(onDetail || onAdd);

  // N = new application (desktop habit; ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        navigate('/add');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <>
    {demo && (
      <div className="pt-safe bg-ink py-1 text-center text-[12px] leading-4 font-semibold text-bg">Demo · fictional data, read-only</div>
    )}
    <div className="min-h-dvh md:flex">
      {/* Fills the status-bar area when the PWA draws under it, so sticky headers never show content behind it. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] bg-bg" />

      {onBoard ? <Rail attention={attention.total} /> : <Sidebar attention={attention} pathname={location.pathname} />}

      <div className={`min-w-0 flex-1 ${hideBottomNav ? 'pb-safe' : 'pb-[calc(76px+env(safe-area-inset-bottom))]'} md:pb-0`}>
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </div>

      <AskHost />

      {!hideBottomNav && (
        <nav className="nav pb-safe fixed inset-x-0 bottom-0 z-40 md:hidden" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `ni ${item.to === '/add' ? 'add' : ''} ${isActive ? 'on' : ''}`}>
              <span className="nic">
                <Icon name={item.icon} />
                {item.attention && attention.total > 0 && (
                  <span className="badge" aria-label={`${attention.total} need you`}>
                    {attention.total > 99 ? '99+' : attention.total}
                  </span>
                )}
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
    </>
  );
}

function Sidebar({ attention, pathname }: { attention: ReturnType<typeof useAttention>; pathname: string }) {
  return (
    <nav className="side sticky top-0 hidden h-dvh md:flex" aria-label="Primary">
      <div className="brand">
        <AppMark size={28} />
        {PRODUCT_NAME}
      </div>
      <Link to="/add" className="btn btn-primary mb-3 h-10 w-full text-sm">
        <Icon name="plus" />
        Add application
        <span className="kbd ml-auto text-inherit opacity-70 shadow-[inset_0_0_0_1px_currentColor]">N</span>
      </Link>
      {NAV.filter((n) => n.to !== '/add').map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => `sn ${isActive || (item.to === '/' && pathname.startsWith('/applications/')) ? 'on' : ''}`}
        >
          <Icon name={item.icon} />
          {item.label}
          {item.attention && attention.total > 0 && <span className="badge2">{attention.total}</span>}
        </NavLink>
      ))}
      <div className="sect px-2.5 pt-5 pb-1.5">Views</div>
      <Link to="/?view=active" className="sn">
        <span className="flex w-5 justify-center st-interview" style={{ color: 'var(--fg)' }}>
          <StatusGlyph className="scale-75" />
        </span>
        Active pipeline
      </Link>
      <Link to="/follow-ups" className="sn">
        <span className="flex w-5 justify-center">
          <span className="mk due" />
        </span>
        Needs follow-up
        {attention.followUps > 0 && <span className="n">{attention.followUps}</span>}
      </Link>
      <Link to="/follow-ups" className="sn">
        <span className="flex w-5 justify-center">
          <span className="mk rev" />
        </span>
        Pending review
        {attention.reviews > 0 && <span className="n">{attention.reviews}</span>}
      </Link>
    </nav>
  );
}

function Rail({ attention }: { attention: number }) {
  const item = (to: string, icon: IconName, label: string, extra?: ReactNode) => (
    <NavLink
      to={to}
      end={to === '/'}
      aria-label={label}
      title={label}
      className={({ isActive }) => `iconbtn ${isActive ? 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line),var(--shadow-1)]' : ''}`}
    >
      <Icon name={icon} />
      {extra}
    </NavLink>
  );
  return (
    <nav className="side sticky top-0 hidden h-dvh w-16 items-center px-2.5 md:flex" aria-label="Primary">
      <div className="mb-3.5">
        <AppMark size={30} />
      </div>
      <Link to="/add" className="iconbtn mb-2.5 h-10 w-10 bg-accent text-accent-ink hover:bg-accent" aria-label="Add application (N)" title="Add application (N)">
        <Icon name="plus" className="[stroke-width:2.4]" />
      </Link>
      {item('/', 'list', 'Applications')}
      {item('/follow-ups', 'inbox', attention ? `Follow-ups, ${attention} need you` : 'Follow-ups', attention > 0 && <span className="dotn" />)}
      {item('/board', 'board', 'Board')}
      {item('/settings', 'gear', 'Settings')}
    </nav>
  );
}

/** Screen title row used by top-level screens (Follow-ups, Board, Settings). */
export function ScreenHeader({ title, count, sub, actions }: { title: ReactNode; count?: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="pt-safe">
      <div className={`hdr ${sub ? 'flex-col items-start gap-0 pt-2' : ''}`}>
        <div className="flex w-full items-center gap-2">
          <h1 className="h1">{title}</h1>
          {count !== undefined && <span className="count">{count}</span>}
          <span className="sp" />
          {actions}
        </div>
        {sub && <div className="text-sm text-ink-3">{sub}</div>}
      </div>
    </header>
  );
}
