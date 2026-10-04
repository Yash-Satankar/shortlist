/**
 * Relocation is stored as willing (yes/no/unknown) + an optional preference, but shown and
 * typed as one line of text: "Yes (Hyderabad preferred)". These two functions convert
 * between them. Parsing is deliberately conservative: only a leading Yes/No sets `willing`;
 * anything else is kept verbatim as the preference with `willing` left unknown.
 */

export interface Relocation {
  willing: boolean | null;
  preference: string | null;
}

const YES = /^(yes|y)\b/i;
const NO = /^(no|n)\b/i;

/** "(Hyderabad preferred)" → "Hyderabad preferred"; ": Bengaluru, Pune" → "Bengaluru, Pune". */
function cleanRest(rest: string): string | null {
  let r = rest.replace(/^[\s:;,.\-–—]+/, '').trim();
  const wrapped = /^\((.*)\)$/.exec(r);
  if (wrapped) r = wrapped[1]!.trim();
  return r || null;
}

export function parseRelocation(text: string | null | undefined): Relocation {
  const t = (text ?? '').trim();
  if (!t) return { willing: null, preference: null };
  const yes = YES.exec(t);
  if (yes) return { willing: true, preference: cleanRest(t.slice(yes[0].length)) };
  const no = NO.exec(t);
  if (no) return { willing: false, preference: cleanRest(t.slice(no[0].length)) };
  return { willing: null, preference: t };
}

export function composeRelocation({ willing, preference }: Relocation): string | null {
  const pref = preference?.trim() || null;
  if (willing === true) return pref ? `Yes (${pref})` : 'Yes';
  if (willing === false) return pref ? `No (${pref})` : 'No';
  return pref;
}
