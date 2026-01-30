/**
 * Format a local Date into YYYY-MM-DD without converting to UTC.
 */
export function formatLocalYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a Date using UTC components (useful when the Date carries a timezone offset).
 */
export function formatUtcYmd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Extract a YYYY-MM-DD string from either a date-only string or an ISO string.
 */
export function extractYmd(input: string): string {
  if (!input) {
    throw new Error('Invalid date input');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  return formatUtcYmd(new Date(input));
}

/**
 * Parse a YYYY-MM-DD string into a local Date at noon (to avoid DST edge cases).
 */
export function parseYmdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/**
 * Normalize any API date (YYYY-MM-DD or ISO) into a local Date suitable for UI controls.
 */
export function normalizeApiDate(input: string | null | undefined, fallback: Date): Date {
  if (!input) {
    return fallback;
  }
  try {
    return parseYmdToLocalDate(extractYmd(input));
  } catch {
    return fallback;
  }
}

/**
 * Convert a value from a form control to a Date instance.
 */
export function ensureDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Compute a numeric YYYYMMDD key for comparison using local calendar values.
 */
export function ymdKeyFromDate(date: Date): number {
  return Number(formatLocalYmd(date).replace(/-/g, ''));
}

/**
 * Get the client timezone (IANA) if available.
 */
export function getClientTimeZone(): string | undefined {
  return Intl?.DateTimeFormat?.().resolvedOptions().timeZone;
}
