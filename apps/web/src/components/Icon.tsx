import type { CSSProperties } from 'react';

/** Inline line icons (Lucide geometry, 24px grid, stroke 1.75) so the app ships no icon font. */
const PATHS = {
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  inbox:
    'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  plus: 'M12 5v14M5 12h14',
  board: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v12h-4z',
  gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M6 9l6 6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  filter: 'M3 6h11M18 6h3M3 12h5M12 12h9M3 18h13M20 18h1M16 4v4M10 10v4M18 16v4',
  sort: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  calendar: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  slash: 'M5 5l14 14',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff:
    'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  key: 'M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM12 11v10M12 17h3M12 14h2',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  clip: 'M15.5 7.5 8.4 14.6a2 2 0 0 0 2.8 2.8l7.1-7.1a4 4 0 0 0-5.7-5.7L5.5 11.7a6 6 0 0 0 8.5 8.5l6-6',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  wifiOff:
    'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.6M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5M12 20h.01',
} as const;

export type IconName = keyof typeof PATHS;

/** `size`: sm 16, xs 14, lg 28, default 20 (the .i classes in components.css). */
export function Icon({ name, size, className = '', style }: { name: IconName; size?: 'xs' | 'sm' | 'lg'; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={`i ${size ? `i-${size}` : ''} ${className}`} style={style} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The app mark: briefcase carrying the same five-step meter as the status glyph. */
export function AppMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ borderRadius: size * 0.22, flex: 'none' }}>
      <rect width="64" height="64" rx="15" fill="#171716" />
      <path d="M25 20v-3.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3V20" fill="none" stroke="#F5F5F1" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="13" y="20" width="38" height="29" rx="5" fill="none" stroke="#F5F5F1" strokeWidth="3.5" />
      {[19.75, 25, 30.25, 35.5, 40.75].map((x, i) => (
        <rect key={x} x={x} y="30" width="3.5" height="10" rx=".8" fill={i < 3 ? '#FF7A4D' : '#F5F5F1'} fillOpacity={i < 3 ? 1 : 0.3} />
      ))}
    </svg>
  );
}
