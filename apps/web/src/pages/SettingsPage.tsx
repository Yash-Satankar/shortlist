import type { CurrentUser } from '../auth/useAuth';
import { useLogout } from '../auth/useAuth';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Layout';
import { Button, Card } from '../components/ui';

/** Profile, resume and answer library arrive in step 1.4c; for now: account basics. */
export function SettingsPage({ user }: { user: CurrentUser }) {
  const logout = useLogout();
  return (
    <>
      <PageHeader title="Settings" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        <Card className="p-4">
          <p className="text-sm text-slate-500">Signed in as</p>
          <p className="font-medium">{user.email}</p>
          <p className="mt-2 text-xs text-slate-500">
            Follow up after {user.settings.followUpAfterDays} days · post-interview after {user.settings.postInterviewFollowUpDays} days · suggest
            ghosted after {user.settings.ghostAfterDays} days
          </p>
        </Card>
        <Button onClick={() => logout.mutate()}>
          <Icon name="logout" className="h-4 w-4" /> Sign out
        </Button>
      </main>
    </>
  );
}
