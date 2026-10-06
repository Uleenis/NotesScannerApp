export type DateParts = { day: number; month: number; year: number | null; time: string };

const RETRY_INTERVAL_MINUTES = 15;
const MINUTE_MS = 60_000;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseMoment(iso: string): number {
  return Date.parse(iso.replace(/\.(\d+)/, (_, digits: string) => `.${digits.padEnd(3, "0").slice(0, 3)}`));
}

export function dateParts(iso: string, now: Date): DateParts | null {
  const date = new Date(parseMoment(iso));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return {
    day: date.getDate(),
    month: date.getMonth(),
    year: date.getFullYear() === now.getFullYear() ? null : date.getFullYear(),
    time: `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`,
  };
}

export function retryMinutes(attemptedAt: string | null, now: Date): number {
  const attempted = attemptedAt === null ? Number.NaN : parseMoment(attemptedAt);
  if (Number.isNaN(attempted)) {
    return RETRY_INTERVAL_MINUTES;
  }
  const remaining = Math.ceil((attempted + RETRY_INTERVAL_MINUTES * MINUTE_MS - now.getTime()) / MINUTE_MS);
  return Math.min(RETRY_INTERVAL_MINUTES, Math.max(1, remaining));
}
