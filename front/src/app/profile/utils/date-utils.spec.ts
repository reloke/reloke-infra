import {
  formatLocalYmd,
  normalizeApiDate,
  parseYmdToLocalDate,
  extractYmd,
} from './date-utils';

describe('date-utils', () => {
  it('formats local date without UTC shift', () => {
    const date = new Date('2026-01-23T00:00:00');
    expect(formatLocalYmd(date)).toBe('2026-01-23');
  });

  it('normalizes ISO string into a local Date on the same day', () => {
    const normalized = normalizeApiDate('2026-01-23T00:00:00Z', new Date());
    expect(formatLocalYmd(normalized)).toBe('2026-01-23');
  });

  it('parses YYYY-MM-DD into a Date object suitable for calendars', () => {
    const parsed = parseYmdToLocalDate('2026-02-02');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(1);
    expect(parsed.getDate()).toBe(2);
  });

  it('extracts YYYY-MM-DD from ISO strings', () => {
    const ymd = extractYmd('2026-03-04T05:06:07Z');
    expect(ymd).toBe('2026-03-04');
  });
});
