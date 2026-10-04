import { useLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";

import { strings } from "@/i18n";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: {
    ensureSession: async () => ({ status: "ready", userId: "test-user" }),
    syncLanguage: async () => true,
  },
}));

jest.mock("@/notebooks/service", () => ({
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn() },
}));

const mockedUseLocales = jest.mocked(useLocales);

beforeEach(() => {
  installFakeNotebooks([histoire]);
});

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
  expect(await screen.findByText(t.library.notebooks)).toBeTruthy();
});

test("sends an unknown address back to the library", async () => {
  const pathname = await openApp("fr", "/nowhere");
  expect(pathname()).toBe("/");
});

test.each([
  ["page", "/page/preview"],
  ["capture", "/capture"],
  ["signIn", "/sign-in"],
  ["code", "/sign-in/code"],
] as const)("opens the %s screen by its address", async (name, path) => {
  const pathname = await openApp("fr", path);
  expect(pathname()).toBe(path);
  expect(screen.getByText(strings.fr.shell[name])).toBeTruthy();
});

test("opens a notebook from the library", async () => {
  const pathname = await openApp("fr");
  await fireEvent.press(await screen.findByText(histoire.name));
  expect(pathname()).toBe(`/notebook/${histoire.id}`);
});

test("opens the capture screen from the library", async () => {
  const pathname = await openApp("fr");
  await fireEvent.press(await screen.findByText(strings.fr.common.scan));
  expect(pathname()).toBe("/capture");
});

test("opens the account from the library header", async () => {
  const pathname = await openApp("fr");
  await fireEvent.press(screen.getByLabelText(strings.fr.account.title));
  expect(pathname()).toBe("/account");
});

test.each([
  ["account", async () => screen.getByLabelText(strings.fr.account.title), strings.fr.common.done],
  ["capture", async () => screen.findByText(strings.fr.common.scan), strings.fr.common.cancel],
  ["new-notebook", async () => screen.findByText(strings.fr.library.newNotebook), strings.fr.common.cancel],
])("closes the %s screen with its header button", async (_, entry, button) => {
  const pathname = await openApp("fr");
  await fireEvent.press(await entry());
  await fireEvent.press(screen.getByText(button));
  expect(pathname()).toBe("/");
});

test.each(["/capture", "/account", "/sign-in", "/new-notebook"])("keeps the library under %s when the app opens on it", async (path) => {
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
