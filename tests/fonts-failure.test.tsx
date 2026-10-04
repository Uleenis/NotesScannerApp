import { useLocales } from "expo-localization";
import { renderRouter, screen } from "expo-router/testing-library";

import { strings } from "@/i18n";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-font", () => ({
  ...jest.requireActual<typeof import("expo-font")>("expo-font"),
  useFonts: () => [false, new Error("font")],
}));
jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));

test("opens the library even when the fonts fail to load", async () => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  await renderRouter("./src/app");
  expect(screen.getByText(strings.fr.shell.notebook)).toBeTruthy();
});
