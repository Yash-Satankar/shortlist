import type { CurrentUser } from '../auth/useAuth';
import { useLogout } from '../auth/useAuth';

/** Placeholder shell; the application list, kanban and quick-add arrive in Phase 1 step 4. */
export function HomePage({ user }: { user: CurrentUser }) {
  const logout = useLogout();
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="font-semibold">Job Tracker</span>
        <button
          onClick={() => logout.mutate()}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Sign out
        </button>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-slate-600 dark:text-slate-400">
          Signed in as <span className="font-medium text-slate-900 dark:text-slate-100">{user.email}</span>.
        </p>
      </main>
    </div>
  );
}
