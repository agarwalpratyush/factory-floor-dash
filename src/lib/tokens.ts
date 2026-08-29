/**
 * Reads a colour from the token block. Nothing may hardcode a hex, so anything
 * needing a colour in script — a chart series, an axis — asks for the token.
 */
export function token(name: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
