import { useState, type FormEvent } from 'react';
import { useLogin } from '../auth/useAuth';

export function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <h1 className="text-xl font-semibold">Job Tracker</h1>
        <label className="block space-y-1">
          <span className="text-sm text-slate-600 dark:text-slate-400">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-base outline-none focus:border-slate-500 dark:border-slate-700"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-slate-600 dark:text-slate-400">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-base outline-none focus:border-slate-500 dark:border-slate-700"
          />
        </label>
        {login.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {login.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded-lg bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
