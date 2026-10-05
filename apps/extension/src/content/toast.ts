import tokensCss from '../../../web/src/styles/tokens.css?raw';

/**
 * A small notice in the page you're on (e.g. "Marked Applied · Undo"). It lives in a closed
 * Shadow DOM: the page can't style or read it, and its styles can't leak into the page.
 * Colours come from the app's own design tokens (light/dark follow your system setting).
 */
export interface ToastOptions {
  message: string;
  action?: { label: string; run: () => Promise<string | void> };
  /** ms before it hides itself (paused while hovered). */
  timeout?: number;
}

const CSS = `
${tokensCss.replaceAll(':root[data-theme="dark"]', ':host([data-theme="dark"])').replaceAll(':root', ':host')}
:host { all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; }
.toast { display: flex; align-items: center; gap: 8px; background: var(--toast-bg); color: var(--toast-ink); border-radius: 14px;
  padding: 4px 4px 4px 14px; font: 500 14px/20px var(--font-sans); box-shadow: var(--shadow-3); min-height: 52px; max-width: 420px;
  animation: in .18s ease-out; }
.mark { width: 24px; height: 24px; flex: none; border-radius: 5px; display: block; }
.msg { flex: 1; min-width: 0; }
.act, .x { color: var(--toast-action); background: transparent; height: 44px; padding: 0 12px; border: 0; font: 700 14px/1 var(--font-sans); border-radius: 10px; cursor: pointer; }
.x { color: var(--toast-ink); opacity: .6; padding: 0 10px; font-weight: 500; font-size: 18px; }
.act:focus-visible, .x:focus-visible { outline: 2px solid var(--toast-action); outline-offset: -2px; }
@keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;

let current: HTMLElement | null = null;

/** The app mark (same drawing as AppMark in the web app), built without innerHTML. */
function appMark(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const svg = el('svg', { viewBox: '0 0 64 64', class: 'mark', 'aria-hidden': 'true' });
  svg.append(
    el('rect', { width: '64', height: '64', rx: '15', fill: '#171716' }),
    el('path', { d: 'M25 20v-3.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3V20', fill: 'none', stroke: '#F5F5F1', 'stroke-width': '3.5', 'stroke-linecap': 'round' }),
    el('rect', { x: '13', y: '20', width: '38', height: '29', rx: '5', fill: 'none', stroke: '#F5F5F1', 'stroke-width': '3.5' }),
    ...[19.75, 25, 30.25, 35.5, 40.75].map((x, i) =>
      el('rect', { x: String(x), y: '30', width: '3.5', height: '10', rx: '.8', fill: i < 3 ? '#FF7A4D' : '#F5F5F1', 'fill-opacity': i < 3 ? '1' : '0.3' }),
    ),
  );
  return svg;
}

export function showToast(opts: ToastOptions): void {
  current?.remove();
  const host = document.createElement('jst-toast');
  host.setAttribute('data-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const box = document.createElement('div');
  box.className = 'toast';
  box.setAttribute('role', 'status');
  const mark = appMark();
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = opts.message;
  box.append(mark, msg);

  let timer = 0;
  const close = () => {
    window.clearTimeout(timer);
    host.remove();
    if (current === host) current = null;
  };
  const arm = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(close, opts.timeout ?? 10_000);
  };

  if (opts.action) {
    const act = document.createElement('button');
    act.className = 'act';
    act.type = 'button';
    act.textContent = opts.action.label;
    const action = opts.action;
    act.addEventListener('click', () => {
      act.disabled = true;
      void action
        .run()
        .then((done) => {
          msg.textContent = done || 'Done';
          act.remove();
          arm();
        })
        .catch((e: unknown) => {
          msg.textContent = e instanceof Error ? e.message : 'That didn’t work';
          act.disabled = false;
        });
    });
    box.append(act);
  }
  const x = document.createElement('button');
  x.className = 'x';
  x.type = 'button';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '×';
  x.addEventListener('click', close);
  box.append(x);

  box.addEventListener('mouseenter', () => window.clearTimeout(timer));
  box.addEventListener('mouseleave', arm);
  root.append(style, box);
  document.documentElement.append(host);
  current = host;
  arm();
}
