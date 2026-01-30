const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    // Will throw if invalid
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return 'UTC';
  }
}

export function assertValidYmd(ymd: string, fieldName: string): string {
  if (!YMD_REGEX.test(ymd)) {
    throw new Error(
      `Invalid date format for ${fieldName}, expected YYYY-MM-DD`,
    );
  }
  return ymd;
}

export function ymdToKey(ymd: string): number {
  return Number(ymd.replace(/-/g, ''));
}

export function formatTodayYmd(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function ymdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0));
}

export function dateToUtcYmd(date: Date | null | undefined): string | null {
  if (!date) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
