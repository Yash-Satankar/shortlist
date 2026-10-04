/**
 * The Details form has one "Phone or LinkedIn" field, but a contact stores both. The field
 * shows the LinkedIn URL if there is one, else the phone. Saving must only change what the
 * user actually edited: the value that wasn't shown is never touched unless the user typed
 * a new value of that kind.
 */

type Reach = { phone?: string | null; linkedinUrl?: string | null };

export const isProfileUrl = (v: string) => /linkedin\.com|^https?:/i.test(v);

/** What the single field shows for a contact. */
export function reachShown(c: { phone: string | null; linkedinUrl: string | null } | undefined): string {
  return c?.linkedinUrl ?? c?.phone ?? '';
}

/**
 * Fields to send for the edited reach value. Omitted keys are left as they are on the server.
 * `current` is the contact as loaded (undefined for a new recruiter).
 */
export function reachPatch(typed: string, current: { phone: string | null; linkedinUrl: string | null } | undefined): Reach {
  const value = typed.trim();
  const shownKind: 'linkedinUrl' | 'phone' | null = current?.linkedinUrl ? 'linkedinUrl' : current?.phone ? 'phone' : null;

  if (!value) return shownKind ? { [shownKind]: null } : {};

  const typedKind = isProfileUrl(value) ? 'linkedinUrl' : 'phone';
  const patch: Reach = { [typedKind]: value };
  // Switching kind replaces what the field was showing; the other field stays untouched.
  if (shownKind && shownKind !== typedKind) patch[shownKind] = null;
  return patch;
}
