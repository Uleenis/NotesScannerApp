import { strings } from "@/i18n";
import { dateParts, parseMoment, retryMinutes } from "@/pages/dates";

const en = strings.en;
const fr = strings.fr;

const now = new Date(2026, 9, 6, 12, 0, 0);
const at = (year: number, month: number, day: number, hour: number, minute: number) => new Date(year, month, day, hour, minute).toISOString();

describe("parseMoment", () => {
  test("reads the moments the database writes, with microseconds and an offset", () => {
    const expected = Date.UTC(2026, 8, 26, 12, 32, 5, 123);
    expect(parseMoment("2026-09-26T12:32:05.123456+00:00")).toBe(expected);
    expect(parseMoment("2026-09-26T14:32:05.123456+02:00")).toBe(expected);
    expect(parseMoment("2026-09-26T12:32:05.123Z")).toBe(expected);
  });

  test("gives the date parser exactly three digits of fraction, the only form every engine reads", () => {
    const parse = jest.spyOn(Date, "parse");
    parseMoment("2026-09-26T12:32:05.123456+00:00");
    parseMoment("2026-09-26T12:32:05.5+00:00");
    expect(parse).toHaveBeenNthCalledWith(1, "2026-09-26T12:32:05.123+00:00");
    expect(parse).toHaveBeenNthCalledWith(2, "2026-09-26T12:32:05.500+00:00");
    parse.mockRestore();
  });

  test("reads a moment with no fraction and one with fewer digits", () => {
    expect(parseMoment("2026-09-26T12:32:05+00:00")).toBe(Date.UTC(2026, 8, 26, 12, 32, 5));
    expect(parseMoment("2026-09-26T12:32:05.5+00:00")).toBe(Date.UTC(2026, 8, 26, 12, 32, 5, 500));
  });

  test("is not a number for a moment that cannot be read", () => {
    expect(parseMoment("not a date")).toBeNaN();
    expect(parseMoment("")).toBeNaN();
  });
});

describe("dateParts", () => {
  test("reads a moment written with microseconds", () => {
    expect(dateParts("2026-09-26T12:32:05.123456+00:00", now)).not.toBeNull();
  });

  test("reads the local day, month and time", () => {
    expect(dateParts(at(2026, 8, 26, 14, 32), now)).toEqual({ day: 26, month: 8, year: null, time: "14:32" });
  });

  test("gives no year for the current year and the year for another one", () => {
    expect(dateParts(at(2026, 0, 1, 0, 0), now)?.year).toBeNull();
    expect(dateParts(at(2025, 11, 31, 23, 59), now)?.year).toBe(2025);
    expect(dateParts(at(2027, 0, 1, 0, 0), now)?.year).toBe(2027);
  });

  test("writes the hour and the minute with two digits", () => {
    expect(dateParts(at(2026, 8, 5, 9, 5), now)?.time).toBe("09:05");
    expect(dateParts(at(2026, 8, 5, 0, 0), now)?.time).toBe("00:00");
  });

  test("gives nothing for a date that cannot be read", () => {
    expect(dateParts("not a date", now)).toBeNull();
    expect(dateParts("", now)).toBeNull();
  });
});

describe("dates in the language files", () => {
  test.each([
    ["short", fr.dates.short(26, 8, null), "26 sept."],
    ["short", en.dates.short(26, 8, null), "Sep 26"],
    ["short with a year", fr.dates.short(26, 8, 2025), "26 sept. 2025"],
    ["short with a year", en.dates.short(26, 8, 2025), "Sep 26, 2025"],
    ["short, first of the year", fr.dates.short(1, 0, null), "1 janv."],
    ["short, last of the year", en.dates.short(31, 11, null), "Dec 31"],
    ["long", fr.dates.long(26, 8, null), "26 septembre"],
    ["long", en.dates.long(26, 8, null), "September 26"],
    ["long with a year", fr.dates.long(26, 8, 2025), "26 septembre 2025"],
    ["long with a year", en.dates.long(26, 8, 2025), "September 26, 2025"],
    ["long, first of the month", fr.dates.long(1, 10, null), "1er novembre"],
    ["long, first of the month", en.dates.long(1, 10, null), "November 1"],
    ["capture time", fr.dates.takenAt(26, 8, null, "14:32"), "Prise le 26 septembre à 14:32"],
    ["capture time", en.dates.takenAt(26, 8, null, "14:32"), "Taken on September 26 at 14:32"],
    ["capture time with a year", fr.dates.takenAt(26, 8, 2025, "14:32"), "Prise le 26 septembre 2025 à 14:32"],
  ])("writes the %s", (_, written, expected) => {
    expect(written).toBe(expected);
  });

  test("names every month of the year in both languages", () => {
    for (const language of [en, fr]) {
      const shorts = Array.from({ length: 12 }, (_, month) => language.dates.short(1, month, null));
      const longs = Array.from({ length: 12 }, (_, month) => language.dates.long(1, month, null));
      expect(new Set(shorts).size).toBe(12);
      expect(new Set(longs).size).toBe(12);
    }
  });
});

describe("retryMinutes", () => {
  const attempted = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  test("is 15 right after an attempt", () => {
    expect(retryMinutes(attempted(0), now)).toBe(15);
  });

  test("counts down to the next attempt, rounded up to the minute", () => {
    expect(retryMinutes(attempted(2), now)).toBe(13);
    expect(retryMinutes(new Date(now.getTime() - 2 * 60_000 - 30_000).toISOString(), now)).toBe(13);
    expect(retryMinutes(attempted(14), now)).toBe(1);
  });

  test("is never under 1, even when the attempt is late", () => {
    expect(retryMinutes(attempted(15), now)).toBe(1);
    expect(retryMinutes(attempted(40), now)).toBe(1);
  });

  test("is 15 when there was no attempt, or when its date cannot be read", () => {
    expect(retryMinutes(null, now)).toBe(15);
    expect(retryMinutes("not a date", now)).toBe(15);
  });

  test("is never over 15, even when the clock of the phone is behind", () => {
    expect(retryMinutes(attempted(-10), now)).toBe(15);
  });
});
