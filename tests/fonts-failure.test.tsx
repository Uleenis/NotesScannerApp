import { useFonts } from "expo-font";
import { useLocales } from "expo-localization";
import { renderRouter, screen } from "expo-router/testing-library";
import * as SplashScreen from "expo-splash-screen";

import { strings } from "@/i18n";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-font", () => ({
  ...jest.requireActual<typeof import("expo-font")>("expo-font"),
  useFonts: jest.fn(),
}));
jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(SplashScreen.hideAsync).mockClear();
});

test("opens the library and hides the launch screen when the fonts fail to load", async () => {
  jest.mocked(useFonts).mockReturnValue([false, new Error("font")]);
  await renderRouter("./src/app");
  expect(screen.getByText(strings.fr.shell.notebook)).toBeTruthy();
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
});

test("opens the library and hides the launch screen when the fonts load", async () => {
  jest.mocked(useFonts).mockReturnValue([true, null]);
  await renderRouter("./src/app");
  expect(screen.getByText(strings.fr.shell.notebook)).toBeTruthy();
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
});

test("keeps the launch screen while the fonts are loading", async () => {
  jest.mocked(useFonts).mockReturnValue([false, null]);
  await renderRouter("./src/app");
  expect(screen.queryByText(strings.fr.shell.notebook)).toBeNull();
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
});
