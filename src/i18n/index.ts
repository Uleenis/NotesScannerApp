import { useLocales, type Locale } from "expo-localization";

import { en, type Strings } from "./en";
import { fr } from "./fr";

export type Language = "en" | "fr";

export const strings: Record<Language, Strings> = { en, fr };

function isLanguage(code: string | null): code is Language {
  return code !== null && Object.hasOwn(strings, code);
}

export function resolveLanguage(locales: readonly Pick<Locale, "languageCode">[]): Language {
  for (const { languageCode } of locales) {
    if (isLanguage(languageCode)) {
      return languageCode;
    }
  }
  return "en";
}

export function useLanguage(): Language {
  return resolveLanguage(useLocales());
}

export function useStrings(): Strings {
  return strings[useLanguage()];
}
