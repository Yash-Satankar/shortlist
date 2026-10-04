import { useState, type FormEvent } from 'react';
import { useLogin, usePublicConfig } from '../auth/useAuth';
import { AppMark } from '../components/Icon';
import { Button, Field, IconButton } from '../components/ui';
import { useThemeSync } from '../lib/theme';

export function LoginPage() {
  useThemeSync();
  const login = useLogin();
  const { sessionTtlDays } = usePublicConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-[400px] flex-col px-6 pt-24 md:justify-center md:pt-0">
      <div className="md:pb-16">
        <AppMark size={56} />
        <h1 className="h1 mt-5">Job Tracker</h1>
        <p className="mt-1 text-[15px] leading-[22px] text-ink-3">Sign in to your tracker.</p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3.5">
          <Field label="Email">
            <input className="inp" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" error={login.error ? (login.error.message || 'That password didn’t match. Try again.') : undefined}>
            <div className={`ig pr-0 ${login.error ? 'err' : ''}`}>
              <input
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={login.error ? true : undefined}
              />
              <IconButton icon={show ? 'eyeOff' : 'eye'} label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)} />
            </div>
          </Field>
          <Button type="submit" variant="primary" size="block" className="mt-1.5" disabled={login.isPending} busy={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
      <p className="hint mt-auto pt-8 pb-6 text-center md:mt-0">{`Stays signed in on this device for ${sessionTtlDays} days unless unused.`}</p>
    </main>
  );
}
