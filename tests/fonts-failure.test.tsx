import { useFonts } from "expo-font";
import { useLocales } from "expo-localization";
import { renderRouter, screen } from "expo-router/testing-library";
import * as SplashScreen from "expo-splash-screen";

import { strings } from "@/i18n";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-font", () => ({
  ...jest.requireActual<typeof import("expo-font")>("expo-font"),
  useFonts: jest.fn(),
}));
jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: {
    watch: () => () => undefined,
    ensureSession: async () => ({ status: "ready", userId: "test-user", email: null, isAnonymous: true }),
    syncLanguage: async () => true,
  },
}));
jest.mock("@/notebooks/service", () => ({
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn() },
}));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(SplashScreen.hideAsync).mockClear();
  installFakeNotebooks([histoire]);
});

test("opens the library and hides the launch screen when the fonts fail to load", async () => {
  jest.mocked(useFonts).mockReturnValue([false, new Error("font")]);
  await renderRouter("./src/app");
  expect(await screen.findByText(strings.fr.library.notebooks)).toBeTruthy();
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
});

test("opens the library and hides the launch screen when the fonts load", async () => {
  jest.mocked(useFonts).mockReturnValue([true, null]);
  await renderRouter("./src/app");
  expect(await screen.findByText(strings.fr.library.notebooks)).toBeTruthy();
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
});

test("keeps the launch screen while the fonts are loading", async () => {
  jest.mocked(useFonts).mockReturnValue([false, null]);
  await renderRouter("./src/app");
  expect(screen.queryByText(strings.fr.library.notebooks)).toBeNull();
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
});
