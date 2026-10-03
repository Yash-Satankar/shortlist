import type { ApplicationStatus, EventSource, SignalConfidence } from '@jt/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { EVENT_SOURCE_BADGE, isAutomaticSource, STATUS_SHORT } from '../lib/status';
import { Icon, type IconName } from './Icon';

// ---------------------------------------------------------------- status

/** Group glyph: in-progress meter, Offer check, Rejected cross, Ghosted dots, Withdrawn minus. Styles in tokens.css. */
export function StatusGlyph({ status, className = '' }: { status?: ApplicationStatus; className?: string }) {
  return <span className={`sg ${status ? `st-${status}` : ''} ${className}`} aria-hidden="true" />;
}

export function StatusPill({
  status,
  size,
  className = '',
  children,
}: {
  status: ApplicationStatus;
  size?: 'lg';
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className={`pill st-${status} ${size === 'lg' ? 'lg' : ''} ${className}`}>
      <StatusGlyph />
      {STATUS_SHORT[status]}
      {children}
    </span>
  );
}

/** Pill-shaped button that opens the status picker. */
export function StatusButton({ status, onClick, className = '' }: { status: ApplicationStatus; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={`pill lg btnlike st-${status} ${className}`} aria-label={`Status: ${STATUS_SHORT[status]}. Change status`}>
      <StatusGlyph />
      {STATUS_SHORT[status]}
      <Icon name="chevron" className="chev" />
    </button>
  );
}

export function EventSourceBadge({ source }: { source: EventSource }) {
  const auto = isAutomaticSource(source);
  return (
    <span className={`es ${auto ? 'auto' : ''}`} title={auto ? 'Automatic' : 'You did this'}>
      {auto && <Icon name="zap" />}
      {EVENT_SOURCE_BADGE[source]}
    </span>
  );
}

/** The API reports confidence as high/low (no percentage), so the bar is a two-step gauge. */
export function Confidence({ value }: { value: SignalConfidence }) {
  return (
    <span className="conf" title={`${value} confidence`}>
      <span className="bar">
        <i style={{ width: value === 'high' ? '100%' : '40%' }} />
      </span>
      {value}
    </span>
  );
}

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'ink' | 'secondary' | 'quiet' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary',
  ink: 'btn-ink',
  secondary: 'btn-sec',
  quiet: 'btn-quiet',
  danger: 'btn-danger',
};

/**
 * Button styling, also for links that look like buttons (never nest <button> in <a>).
 * md = 44px touch target; sm = 32px, for pointer layouts only; block = full-width 52px.
 */
export function buttonClass(variant: Variant = 'secondary', size: 'sm' | 'md' | 'block' = 'md') {
  return `btn ${VARIANTS[variant]} ${size === 'sm' ? 'btn-sm' : size === 'block' ? 'btn-block' : ''}`;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  busy = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'block'; busy?: boolean }) {
  return (
    <button type="button" aria-busy={busy || undefined} {...props} className={`${buttonClass(variant, size)} ${className}`}>
      {busy && <span className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" aria-label={label} {...props} className={`iconbtn ${className}`}>
      <Icon name={icon} />
    </button>
  );
}

// ---------------------------------------------------------------- fields

export const inputClass = 'inp';

export function Field({
  label,
  children,
  hint,
  error,
  optional,
  className = '',
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="lbl">
        {label}
        {optional && <span className="opt">optional</span>}
      </span>
      {children}
      {error ? <span className="hint err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

/** Segmented control (radio group). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`sw ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />;
}

// ---------------------------------------------------------------- layout bits

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

/** Notebook-style index label: mono, uppercase, with an optional count and right-side action. */
export function SectionLabel({ children, count, action, className = '' }: { children: ReactNode; count?: number; action?: ReactNode; className?: string }) {
  return (
    <h2 className={`sect m-0 ${className}`}>
      {children}
      {count !== undefined && <span className="n">· {count}</span>}
      {action && <span className="act">{action}</span>}
    </h2>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-ink-3" role="status">
      <span className="spin" aria-hidden="true" />
      {label}
    </div>
  );
}

/** Placeholder rows while the list loads. */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  const widths: Array<[number, number]> = [[110, 220], [90, 180], [130, 240], [100, 200]];
  return (
    <div className="list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="row">
          <span />
          <span className="rb gap-2 pt-1">
            <span className="flex justify-between">
              <span className="sk" style={{ width: widths[i % 4]![0], height: 14 }} />
              <span className="sk" style={{ width: 64, height: 18, borderRadius: 6 }} />
            </span>
            <span className="sk" style={{ width: widths[i % 4]![1] }} />
            <span className="sk" style={{ width: 140, height: 10 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <Icon name={icon} size="lg" className="text-ink-3" />}
      <p className="mt-3 text-base font-semibold">{title}</p>
      {children && <div className="mt-1 text-[13px] leading-5 text-ink-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="banner err">
      <Icon name="alert" />
      <div className="min-w-0 flex-1">{error instanceof Error ? error.message : 'Something went wrong'}</div>
      {onRetry && (
        <Button size="sm" className="self-center" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog from sm up. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  headerAction,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  headerAction?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="scrim cursor-default" onClick={onClose} />
      <div className="sheet relative max-h-[88dvh] w-full sm:max-w-md sm:rounded-sheet">
        <div className="grab sm:hidden" />
        <div className="sheet-h">
          <h2>{title}</h2>
          {headerAction ?? <IconButton icon="x" label="Close" onClick={onClose} />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="pb-safe px-4 pt-3 shadow-[0_-1px_0_var(--line)]">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

interface Toast {
  id: number;
  message: ReactNode;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.action ? 6000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-3 md:bottom-6"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="toast pointer-events-auto w-full max-w-[400px]">
            {t.tone === 'error' && <Icon name="alert" size="sm" className="text-[var(--toast-action)]" />}
            <span className="msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="act"
                onClick={() => {
                  t.action!.run();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label === 'Undo' && <Icon name="undo" />}
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
