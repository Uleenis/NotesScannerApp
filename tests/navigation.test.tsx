import { useLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";

import { strings } from "@/i18n";
import { granted, installPermission } from "./fake-camera";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: {
    watch: () => () => undefined,
    ensureSession: async () => ({ status: "ready", userId: "test-user", email: null, isAnonymous: true }),
    syncLanguage: async () => true,
  },
}));

jest.mock("@/auth/account-service", () => require("./account-service-module").accountServiceModule);

jest.mock("@/notebooks/service", () => ({
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn(), chapters: jest.fn(async () => []) },
}));

jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("@/capture/service", () => ({
  captureService: {
    allowance: jest.fn(async () => null),
    latestNotebookId: jest.fn(async () => null),
    send: jest.fn(),
  },
}));
jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(async () => []), get: jest.fn(async () => null), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn(), words: jest.fn(async () => ({ words: [], corrections: [], gaps: [] })), correct: jest.fn(), edit: jest.fn(), alerts: jest.fn(async () => []), second: jest.fn(async () => null) },
}));

const mockedUseLocales = jest.mocked(useLocales);

beforeEach(() => {
  installFakeNotebooks([histoire]);
  installPermission(granted);
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
  ["signIn", "/sign-in", strings.fr.signIn.signUpTitle],
  ["code", "/sign-in/code", strings.fr.code.title],
] as const)("opens the %s screen by its address", async (_name, path, title) => {
  const pathname = await openApp("fr", path);
  expect(pathname()).toBe(path);
  expect(screen.getByText(title)).toBeTruthy();
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
  await fireEvent.press(await screen.findByText(button));
  expect(pathname()).toBe("/");
});

test.each(["/capture", "/account", "/sign-in", "/new-notebook"])("keeps the library under %s when the app opens on it", async (path) => {
  const pathname = await openApp("fr", path);
  expect(pathname()).toBe(path);
  await fireEvent.press(await screen.findByText(path === "/account" ? strings.fr.common.done : strings.fr.common.cancel));
  expect(pathname()).toBe("/");
});

test("keeps the e-mail step under the code step", async () => {
  const pathname = await openApp("fr", "/sign-in/code");
  await act(() => router.back());
  expect(pathname()).toBe("/sign-in");
});
