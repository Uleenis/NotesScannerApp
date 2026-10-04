import type { Locale } from "expo-localization";

export function phoneLocale(languageCode: string | null): Locale {
  return {
    languageTag: languageCode ?? "und",
    languageCode,
    languageScriptCode: null,
    regionCode: null,
    languageRegionCode: null,
    currencyCode: null,
    currencySymbol: null,
    languageCurrencyCode: null,
    languageCurrencySymbol: null,
    decimalSeparator: null,
    digitGroupingSeparator: null,
    textDirection: "ltr",
    measurementSystem: null,
    temperatureUnit: null,
  };
}
