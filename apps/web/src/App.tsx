import { Navigate, Route, Routes } from 'react-router';
import { useCurrentUser } from './auth/useAuth';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  const { data: user, isPending, error } = useCurrentUser();

  if (isPending) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">Could not reach the server: {error.message}</div>;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<HomePage user={user} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
