import { PRODUCT_NAME } from '@jt/shared';
import { useState, type FormEvent } from 'react';
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from '../../api/hooks';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Field, IconButton, SectionLabel, Sheet, Spinner, useToast } from '../../components/ui';
import { describeDevice } from '../../lib/device';
import { formatDate, relativeDays } from '../../lib/format';

/**
 * Settings → Browser extension: pair a browser (creates a labelled API token, shown once)
 * and revoke paired browsers. Tokens can't create tokens; this needs a signed-in session.
 */
export function ExtensionSection() {
  const tokens = useApiTokens();
  const revoke = useRevokeApiToken();
  const toast = useToast();
  const [pairing, setPairing] = useState(false);
  const active = (tokens.data ?? []).filter((t) => !t.revokedAt);

  return (
    <>
      <SectionLabel className="pt-[22px]" action="Save jobs from Chrome">
        Browser extension
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        {tokens.isPending ? (
          <Spinner />
        ) : (
          <div className="group">
            {active.length === 0 && <div className="gi text-sm text-ink-3">No browser paired yet.</div>}
            {active.map((t) => (
              <div key={t.id} className="gi pr-1">
                <Icon name="key" className="text-ink-2" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-5 font-semibold">{t.name}</div>
                  <div className="ev-time leading-4">
                    {t.lastUsedAt ? `used ${relativeDays(t.lastUsedAt)}` : 'not used yet'} · paired {formatDate(t.createdAt)}
                  </div>
                </div>
                <Button
                  variant="quiet"
                  className="px-3 text-sm"
                  disabled={revoke.isPending}
                  onClick={() =>
                    window.confirm(`Disconnect "${t.name}"? The extension in that browser stops working until it's paired again.`) &&
                    revoke.mutate(t.id, {
                      onSuccess: () => toast({ message: `${t.name} disconnected`, tone: 'info' }),
                      onError: (err) => toast({ message: err.message, tone: 'error' }),
                    })
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
        <ErrorNote error={tokens.error} />
        <Button className="w-full" onClick={() => setPairing(true)}>
          <Icon name="link" />
          Pair a browser
        </Button>
      </div>
      <PairSheet open={pairing} onClose={() => setPairing(false)} />
    </>
  );
}

function PairSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateApiToken();
  const toast = useToast();
  const [label, setLabel] = useState(() => describeDevice(navigator.userAgent).name);
  const [code, setCode] = useState<string | null>(null);

  const close = () => {
    setCode(null); // the code is never shown again
    create.reset();
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(label.trim(), { onSuccess: ({ token }) => setCode(token.token) });
  };

  return (
    <Sheet open={open} onClose={close} title="Pair a browser">
      {code ? (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <Field label="Pairing code" hint={`Shown once. Paste it into the ${PRODUCT_NAME} extension popup, then close this.`}>
            <div className="ig pr-0">
              <input className="num" readOnly value={code} onFocus={(e) => e.currentTarget.select()} aria-label="Pairing code" />
              <IconButton
                icon="copy"
                label="Copy pairing code"
                onClick={() => navigator.clipboard.writeText(code).then(() => toast({ message: 'Pairing code copied', tone: 'info' }))}
              />
            </div>
          </Field>
          <Button variant="primary" size="block" onClick={close}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
          <Field label="Label" hint="So you can tell paired browsers apart later.">
            <input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} required />
          </Field>
          <ErrorNote error={create.error} />
          <Button type="submit" variant="primary" size="block" disabled={!label.trim() || create.isPending} busy={create.isPending}>
            Create pairing code
          </Button>
        </form>
      )}
    </Sheet>
  );
}
