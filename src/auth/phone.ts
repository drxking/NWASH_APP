export const NEPAL_CALLING_CODE = '+977';

// Accept local entry or a pasted/autofilled Nepal number without doubling +977.
// Keep an unexpected '+' visible so another country's number fails validation.
export function nepalPhoneInput(value: string): string {
  const compact = value.trim().replace(/[ ()-]/g, '');
  if (compact.startsWith(NEPAL_CALLING_CODE)) return compact.slice(4);
  if (/^977\d{10}$/.test(compact)) return compact.slice(3);
  return compact;
}
export function nepalPhoneNumber(value: string): string | null {
  const local = nepalPhoneInput(value);
  return /^\d{10}$/.test(local) ? `${NEPAL_CALLING_CODE}${local}` : null;
}
