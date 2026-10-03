import { Navigate, Route, Routes } from 'react-router';
import { useCurrentUser } from './auth/useAuth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ApplicationPage } from './pages/ApplicationPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const { data: user, isPending, error } = useCurrentUser();

  if (isPending) return <Spinner />;
  if (error) return <div className="p-6 text-rose-600">Could not reach the server: {error.message}</div>;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ApplicationsPage />} />
        <Route path="applications/:id" element={<ApplicationPage />} />
        <Route path="follow-ups" element={<FollowUpsPage />} />
        <Route path="settings" element={<SettingsPage user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
