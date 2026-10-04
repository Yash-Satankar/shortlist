/** "Windows · Chrome" from a user-agent string; good enough to recognise your own devices. */
export function describeDevice(ua: string | null): { name: string; mobile: boolean } {
  if (!ua) return { name: 'Unknown device', mobile: false };
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { name: os ? `${os} · ${browser}` : browser, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}
