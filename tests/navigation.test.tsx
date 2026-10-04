import { useLocales } from "expo-localization";
import { renderRouter, screen } from "expo-router/testing-library";

import { strings } from "@/i18n";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));

const mockedUseLocales = jest.mocked(useLocales);

async function openApp(languageCode: string, initialUrl = "/"): Promise<() => string> {
  mockedUseLocales.mockReturnValue([phoneLocale(languageCode)]);
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return () => app.getPathname();
}

test.each([
  ["fr", strings.fr],
  ["en", strings.en],
  ["de", strings.en],
] as const)("opens on the library with a phone in %s", async (languageCode, t) => {
  const pathname = await openApp(languageCode);
  expect(pathname()).toBe("/");
  expect(screen.getByText(t.shell.notebook)).toBeTruthy();
});

test("sends an unknown address back to the library", async () => {
  const pathname = await openApp("fr", "/nowhere");
  expect(pathname()).toBe("/");
});
