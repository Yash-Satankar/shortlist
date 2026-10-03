import { Navigate, Route, Routes } from 'react-router';
import { useCurrentUser } from './auth/useAuth';
import { Layout } from './components/Layout';
import { ErrorNote, Spinner } from './components/ui';
import { useThemeSync } from './lib/theme';
import { AddPage } from './pages/AddPage';
import { ApplicationPage } from './pages/ApplicationPage';
import { ApplicationsSplit, NoSelection } from './pages/ApplicationsPage';
import { BoardPage } from './pages/BoardPage';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharePage } from './pages/SharePage';

export function App() {
  useThemeSync();
  const { data: user, isPending, error, refetch } = useCurrentUser();

  if (isPending) return <Spinner />;
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
