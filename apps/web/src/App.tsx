import { lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useCurrentUser } from './auth/useAuth';
import { Layout } from './components/Layout';
import { ErrorNote, Spinner } from './components/ui';
import { useThemeSync } from './lib/theme';
import { ApplicationsSplit, NoSelection } from './pages/ApplicationsPage';
import { LoginPage } from './pages/LoginPage';

// Route-level code splitting: the Applications list (the landing screen) is in the main bundle;
// every other screen is its own chunk, prefetched when the browser is idle so switching screens
// never waits on the network.
const loaders = {
  application: () => import('./pages/ApplicationPage'),
  followUps: () => import('./pages/FollowUpsPage'),
  add: () => import('./pages/AddPage'),
  share: () => import('./pages/SharePage'),
  board: () => import('./pages/BoardPage'),
  settings: () => import('./pages/SettingsPage'),
};
const ApplicationPage = lazy(() => loaders.application().then((m) => ({ default: m.ApplicationPage })));
const FollowUpsPage = lazy(() => loaders.followUps().then((m) => ({ default: m.FollowUpsPage })));
const AddPage = lazy(() => loaders.add().then((m) => ({ default: m.AddPage })));
const SharePage = lazy(() => loaders.share().then((m) => ({ default: m.SharePage })));
const BoardPage = lazy(() => loaders.board().then((m) => ({ default: m.BoardPage })));
const SettingsPage = lazy(() => loaders.settings().then((m) => ({ default: m.SettingsPage })));

/** First load: after a few seconds, say why it's slow (a free-hosted server waking up). */
function WakingSpinner() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(t);
  }, []);
  return <Spinner label={slow ? 'Waking up the server… On free hosting this can take up to a minute.' : 'Loading…'} />;
}

function usePrefetchRoutes(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const run = () => Object.values(loaders).forEach((load) => void load().catch(() => undefined));
    const idle = window.requestIdleCallback?.(run, { timeout: 3000 }) ?? window.setTimeout(run, 1500);
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(idle) : window.clearTimeout(idle));
  }, [enabled]);
}

export function App() {
  useThemeSync();
  const { data: user, isPending, error, refetch } = useCurrentUser();
  usePrefetchRoutes(Boolean(user));

  if (isPending) return <WakingSpinner />;
  if (error)
    return (
      <div className="pt-safe mx-auto max-w-md p-6">
        <ErrorNote error={new Error(`Couldn’t reach the server: ${error.message}`)} onRetry={() => void refetch()} />
      </div>
    );
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route element={<ApplicationsSplit />}>
          <Route index element={<NoSelection />} />
          <Route path="applications/:id" element={<ApplicationPage />} />
        </Route>
        <Route path="follow-ups" element={<FollowUpsPage />} />
        <Route path="add" element={<AddPage />} />
        <Route path="share" element={<SharePage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="settings" element={<SettingsPage user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
