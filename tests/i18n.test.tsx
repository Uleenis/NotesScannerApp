import { renderHook } from "@testing-library/react-native";
import { useLocales } from "expo-localization";

import { resolveLanguage, useStrings, type Language } from "@/i18n";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));

const mockedUseLocales = jest.mocked(useLocales);

function shape(node: object, prefix = ""): string[] {
  return Object.entries(node)
    .flatMap(([key, value]) =>
      typeof value === "object" && value !== null
        ? shape(value, `${prefix}${key}.`)
        : [`${prefix}${key}:${typeof value}`],
    )
    .sort();
}

function emptyStrings(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? emptyStrings(value, `${prefix}${key}.`)
      : value === ""
        ? [`${prefix}${key}`]
        : [],
  );
}

test("French has exactly the keys of English", () => {
  expect(shape(fr)).toEqual(shape(en));
});

test("no language has an empty string", () => {
  expect(emptyStrings(en)).toEqual([]);
  expect(emptyStrings(fr)).toEqual([]);
});

const cases: [Array<string | null>, Language][] = [
  [["fr"], "fr"],
  [["en"], "en"],
  [["de", "fr"], "fr"],
  [["de", "en", "fr"], "en"],
  [["de"], "en"],
  [[null], "en"],
  [[], "en"],
];

test.each(cases)("phone languages %j give %s", (codes, expected) => {
  expect(resolveLanguage(codes.map((languageCode) => ({ languageCode })))).toBe(expected);
});

test("strings follow a change of the phone language", async () => {
  mockedUseLocales.mockReturnValue([phoneLocale("fr")]);
  const { result, rerender } = await renderHook(() => useStrings());
  expect(result.current).toBe(fr);
  mockedUseLocales.mockReturnValue([phoneLocale("en")]);
  await rerender({});
  expect(result.current).toBe(en);
});
