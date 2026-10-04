import { useLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";

import { strings } from "@/i18n";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: {
    ensureSession: async () => ({ status: "ready", userId: "test-user" }),
    syncLanguage: async () => true,
  },
}));

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

test.each([
  ["notebook", "/notebook/preview"],
  ["page", "/page/preview"],
  ["capture", "/capture"],
  ["signIn", "/sign-in"],
  ["code", "/sign-in/code"],
] as const)("opens the %s screen from the library", async (name, path) => {
  const pathname = await openApp("fr");
  await fireEvent.press(screen.getByText(strings.fr.shell[name]));
  expect(pathname()).toBe(path);
  expect(screen.getByText(strings.fr.shell[name])).toBeTruthy();
});

test("opens the account from the library header", async () => {
  const pathname = await openApp("fr");
  await fireEvent.press(screen.getByLabelText(strings.fr.account.title));
  expect(pathname()).toBe("/account");
});

test.each([
  ["account", () => screen.getByLabelText(strings.fr.account.title), strings.fr.common.done],
  ["capture", () => screen.getByText(strings.fr.shell.capture), strings.fr.common.cancel],
  ["sign-in", () => screen.getByText(strings.fr.shell.signIn), strings.fr.common.cancel],
])("closes the %s screen with its header button", async (_, entry, button) => {
  const pathname = await openApp("fr");
  await fireEvent.press(entry());
  await fireEvent.press(screen.getByText(button));
  expect(pathname()).toBe("/");
});

test.each(["/capture", "/account", "/sign-in"])("keeps the library under %s when the app opens on it", async (path) => {
  const pathname = await openApp("fr", path);
  expect(pathname()).toBe(path);
  await fireEvent.press(screen.getByText(path === "/account" ? strings.fr.common.done : strings.fr.common.cancel));
  expect(pathname()).toBe("/");
});

test("keeps the e-mail step under the code step", async () => {
  const pathname = await openApp("fr", "/sign-in/code");
  await act(() => router.back());
  expect(pathname()).toBe("/sign-in");
});
