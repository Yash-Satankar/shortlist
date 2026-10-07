import { PRODUCT_NAME } from '@jt/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuthAction, useLogin, usePublicConfig } from '../auth/useAuth';
import { AppMark } from '../components/Icon';
import { Button, ErrorNote, Field, IconButton } from '../components/ui';
import { useThemeSync } from '../lib/theme';

/**
 * Everything before you're signed in: sign-in, and (only where the server allows them) first-run
 * setup, sign-up with an invite or open sign-up, confirming your email, and password reset.
 * Links arrive as /?invite=…, /verify?token=…, /reset?token=…; confirming is a button press, so
 * an email scanner opening the link can't use it up.
 */
export function LoginPage() {
  useThemeSync();
  const config = usePublicConfig();
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname;
  const [screen, setScreen] = useState<'login' | 'signup' | 'forgot'>(params.get('invite') ? 'signup' : 'login');

  // Until the config arrives, the sign-in form shows (the common case): no blank flash.
  if (config.demo) return <DemoScreen />;
  if (config.needsSetup) return <SetupScreen />;
  if (path === '/verify' && params.get('token')) return <VerifyScreen token={params.get('token')!} />;
  if (path === '/reset' && params.get('token')) return <ResetScreen token={params.get('token')!} />;
  if (screen === 'signup') return <SignupScreen invite={params.get('invite')} onBack={() => setScreen('login')} />;
  if (screen === 'forgot') return <ForgotScreen onBack={() => setScreen('login')} />;
  return <SignInScreen onSignup={config.signupMode === 'open' ? () => setScreen('signup') : undefined} onForgot={config.emailEnabled ? () => setScreen('forgot') : undefined} />;
}

function Shell({ subtitle, children, footer }: { subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-[400px] flex-col px-6 pt-24 md:justify-center md:pt-0">
      <div className="md:pb-16">
        <AppMark size={56} />
        <h1 className="h1 mt-5">{PRODUCT_NAME}</h1>
        <p className="mt-1 text-[15px] leading-[22px] text-ink-3">{subtitle}</p>
        {children}
      </div>
      {footer}
    </main>
  );
}

function PasswordInput({ value, onChange, error, autoComplete }: { value: string; onChange: (v: string) => void; error?: boolean; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`ig pr-0 ${error ? 'err' : ''}`}>
      <input type={show ? 'text' : 'password'} autoComplete={autoComplete} required value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} />
      <IconButton icon={show ? 'eyeOff' : 'eye'} label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)} />
    </div>
  );
}

function SignInScreen({ onSignup, onForgot }: { onSignup?: () => void; onForgot?: () => void }) {
  const login = useLogin();
  const { sessionTtlDays } = usePublicConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <Shell subtitle="Sign in to your tracker." footer={<p className="hint mt-auto pt-8 pb-6 text-center md:mt-0">{`Stays signed in on this device for ${sessionTtlDays} days unless unused.`}</p>}>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3.5">
        <Field label="Email">
          <input className="inp" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" error={login.error ? (login.error.message || 'That password didn’t match. Try again.') : undefined}>
          <PasswordInput value={password} onChange={setPassword} error={Boolean(login.error)} autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary" size="block" className="mt-1.5" disabled={login.isPending} busy={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
        {(onForgot || onSignup) && (
          <div className="flex justify-between gap-3">
            {onForgot ? (
              <Button variant="quiet" className="-ml-2 px-2 text-sm" onClick={onForgot}>
                Forgot password?
              </Button>
            ) : (
              <span />
            )}
            {onSignup && (
              <Button variant="quiet" className="-mr-2 px-2 text-sm" onClick={onSignup}>
                Create account
              </Button>
            )}
          </div>
        )}
      </form>
    </Shell>
  );
}

/** Name, email, password: shared by first-run setup and sign-up. */
function AccountForm({ submitLabel, busy, error, onSubmit, children }: { submitLabel: string; busy: boolean; error: Error | null; onSubmit: (v: { name: string; email: string; password: string }) => void; children?: ReactNode }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      className="mt-8 flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name: name.trim(), email, password });
      }}
    >
      <Field label="Your name" optional>
        <input className="inp" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email">
        <input className="inp" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" hint="At least 10 characters. A few random words work well.">
        <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
      </Field>
      {error && <ErrorNote error={error} />}
      <Button type="submit" variant="primary" size="block" className="mt-1.5" disabled={busy || password.length < 10} busy={busy}>
        {submitLabel}
      </Button>
      {children}
    </form>
  );
}

/** The public demo: one button, no account. */
function DemoScreen() {
  const enter = useAuthAction<Record<string, never>>('/auth/demo');
  return (
    <Shell subtitle="A live demo with fictional applications." footer={<p className="hint mt-auto pt-8 pb-6 text-center md:mt-0">Read-only. Nothing here is real, and the data resets every night.</p>}>
      <div className="mt-8 flex flex-col gap-3.5">
        <p className="m-0 text-[15px] leading-[22px]">
          Browse a job search in progress: statuses updated from emails and job portals, the follow-ups inbox, prep packs, drafts and Ask my job search.
        </p>
        {enter.error && <ErrorNote error={enter.error} />}
        <Button variant="primary" size="block" disabled={enter.isPending} busy={enter.isPending} onClick={() => enter.mutate({})}>
          Try the demo
        </Button>
      </div>
    </Shell>
  );
}

function SetupScreen() {
  const setup = useAuthAction<{ name?: string; email: string; password: string }>('/auth/setup');
  return (
    <Shell subtitle="Welcome. Create the first account: it runs this server (admin)." footer={<p className="hint mt-auto pt-8 pb-6 text-center md:mt-0">This screen disappears once the account exists.</p>}>
      <AccountForm submitLabel={setup.isPending ? 'Creating…' : 'Create admin account'} busy={setup.isPending} error={setup.error} onSubmit={(v) => setup.mutate({ ...v, name: v.name || undefined })} />
    </Shell>
  );
}

function SignupScreen({ invite, onBack }: { invite: string | null; onBack: () => void }) {
  const signup = useAuthAction<{ name?: string; email: string; password: string; invite?: string }>('/auth/signup');
  if (signup.data?.verificationSent) {
    return (
      <Shell subtitle="Check your inbox.">
        <p className="mt-8 text-[15px] leading-[22px]">We sent you a link to confirm your email. Open it on this device to finish creating your account.</p>
        <Button variant="quiet" className="-ml-2 mt-4 px-2 text-sm" onClick={onBack}>
          Back to sign in
        </Button>
      </Shell>
    );
  }
  return (
    <Shell subtitle={invite ? 'You’ve been invited. Create your account.' : 'Create your account.'}>
      <AccountForm submitLabel={signup.isPending ? 'Creating…' : 'Create account'} busy={signup.isPending} error={signup.error} onSubmit={(v) => signup.mutate({ ...v, name: v.name || undefined, invite: invite ?? undefined })}>
        <Button variant="quiet" className="-ml-2 self-start px-2 text-sm" onClick={onBack}>
          I already have an account
        </Button>
      </AccountForm>
    </Shell>
  );
}

function VerifyScreen({ token }: { token: string }) {
  const verify = useAuthAction<{ token: string }>('/auth/verify');
  return (
    <Shell subtitle="Confirm your email.">
      <div className="mt-8 flex flex-col gap-3.5">
        {verify.error && <ErrorNote error={verify.error} />}
        <Button variant="primary" size="block" disabled={verify.isPending} busy={verify.isPending} onClick={() => verify.mutate({ token })}>
          Confirm and sign in
        </Button>
      </div>
    </Shell>
  );
}

function ForgotScreen({ onBack }: { onBack: () => void }) {
  const request = useAuthAction<{ email: string }>('/auth/password-reset/request');
  const [email, setEmail] = useState('');
  return (
    <Shell subtitle="Reset your password.">
      {request.isSuccess ? (
        <p className="mt-8 text-[15px] leading-[22px]">If {email} has an account here, a reset link is on its way. It works once and expires soon.</p>
      ) : (
        <form
          className="mt-8 flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate({ email });
          }}
        >
          <Field label="Email">
            <input className="inp" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {request.error && <ErrorNote error={request.error} />}
          <Button type="submit" variant="primary" size="block" disabled={request.isPending} busy={request.isPending}>
            Email me a reset link
          </Button>
        </form>
      )}
      <Button variant="quiet" className="-ml-2 mt-3 px-2 text-sm" onClick={onBack}>
        Back to sign in
      </Button>
    </Shell>
  );
}

function ResetScreen({ token }: { token: string }) {
  const reset = useAuthAction<{ token: string; newPassword: string }>('/auth/password-reset/confirm');
  const [password, setPassword] = useState('');
  return (
    <Shell subtitle="Choose a new password.">
      {reset.isSuccess ? (
        <>
          <p className="mt-8 text-[15px] leading-[22px]">Your password is changed and every device was signed out.</p>
          <a className="btn btn-primary mt-4 w-full" href="/">
            Sign in
          </a>
        </>
      ) : (
        <form
          className="mt-8 flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate({ token, newPassword: password });
          }}
        >
          <Field label="New password" hint="At least 10 characters.">
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
          </Field>
          {reset.error && <ErrorNote error={reset.error} />}
          <Button type="submit" variant="primary" size="block" disabled={reset.isPending || password.length < 10} busy={reset.isPending}>
            Set new password
          </Button>
        </form>
      )}
    </Shell>
  );
}
