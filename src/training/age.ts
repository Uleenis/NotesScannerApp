export const OLDEST_BIRTH_YEAR = 1900;

const FOUR_DIGITS = /^[0-9]{4}$/;
const REGION = /^[A-Za-z]{2}$/;

export function parisYear(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(now));
}

export function parseBirthYear(text: string, currentYear: number): number | null {
  const trimmed = text.trim();
  if (!FOUR_DIGITS.test(trimmed)) {
    return null;
  }
  const year = Number(trimmed);
  return year >= OLDEST_BIRTH_YEAR && year <= currentYear ? year : null;
}

export function countryFromRegion(region: string | null | undefined): string {
  return typeof region === "string" && REGION.test(region) ? region.toUpperCase() : "";
}
