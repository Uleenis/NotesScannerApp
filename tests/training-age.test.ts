import { countryFromRegion, OLDEST_BIRTH_YEAR, parisYear, parseBirthYear } from "@/training/age";

describe("parisYear", () => {
  test("gives the year of Paris, not the year of the clock in UTC", () => {
    expect(parisYear(new Date("2026-12-31T22:59:59Z"))).toBe(2026);
    expect(parisYear(new Date("2026-12-31T23:00:00Z"))).toBe(2027);
    expect(parisYear(new Date("2027-06-30T22:30:00Z"))).toBe(2027);
  });
});

describe("parseBirthYear", () => {
  test("accepts four digits between 1900 and the current year", () => {
    expect(parseBirthYear("1900", 2026)).toBe(OLDEST_BIRTH_YEAR);
    expect(parseBirthYear("2026", 2026)).toBe(2026);
    expect(parseBirthYear("2012", 2026)).toBe(2012);
    expect(parseBirthYear(" 1987 ", 2026)).toBe(1987);
  });

  test.each(["", "  ", "1899", "2027", "87", "19870", "abcd", "19 87", "-1987", "1987.0", "1e3", "٢٠١٢", "0x7C0"])("refuses %p", (text) => {
    expect(parseBirthYear(text, 2026)).toBeNull();
  });
});

describe("countryFromRegion", () => {
  test("keeps a region of two letters in capitals", () => {
    expect(countryFromRegion("FR")).toBe("FR");
    expect(countryFromRegion("be")).toBe("BE");
  });

  test.each([null, undefined, "", "F", "FRA", "F1", "419", "é€", " F"])("gives an empty country for %p", (region) => {
    expect(countryFromRegion(region)).toBe("");
  });
});
