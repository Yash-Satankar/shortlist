import { useEffect, useState } from 'react';

/** Per-device appearance preference. public/theme-init.js applies it before first paint. */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'jt-theme';
const BAR_COLOR = { light: '#F5F5F1', dark: '#121211' } as const; // = --bg in each theme
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref) {
  const resolved = pref === 'system' ? (media().matches ? 'dark' : 'light') : pref;
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOR[resolved]);
}

/** Call once at the root: keeps "System" in step with the OS and the system bar colour in sync. */
export function useThemeSync() {
  useEffect(() => {
    applyTheme(readThemePref());
    const onChange = () => readThemePref() === 'system' && applyTheme('system');
    const m = media();
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  const set = (p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      // Private mode: still apply for this session.
    }
    setPref(p);
    applyTheme(p);
  };
  return [pref, set];
}
