import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert, Linking, type AlertButton } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { legalLinks } from "@/lib/legal-links";
import { installFakeAccount, refused } from "./fake-account-service";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: { watch: () => () => undefined, ensureSession: jest.fn(), syncLanguage: jest.fn() },
}));
jest.mock("@/auth/account-service", () => require("./account-service-module").accountServiceModule);
jest.mock("@/lib/query-client", () => {
  const actual = jest.requireActual<typeof import("@/lib/query-client")>("@/lib/query-client");
  const { QueryClient } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, createQueryClient: () => new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock("@/notebooks/service", () => ({ notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn(), chapters: jest.fn(async () => []) } }));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(async () => []), count: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn(), words: jest.fn(), correct: jest.fn(), edit: jest.fn(), alerts: jest.fn(async () => []) },
}));

const fr = strings.fr;
const en = strings.en;

const EMAIL = "reader@example.test";

const registeredAllowance: Allowance = { isAnonymous: false, used: 9, max: 15, remaining: 6, resetsAt: null, blockedReason: null };
const anonymousAllowance: Allowance = { isAnonymous: true, used: 1, max: 3, remaining: 2, resetsAt: null, blockedReason: null };

let service: ReturnType<typeof installFakeAccount>;
let alert: jest.SpyInstance;

function signedInAs(kind: "registered" | "anonymous") {
  jest
    .mocked(defaultAuthServices.ensureSession)
    .mockResolvedValue(
      kind === "registered"
        ? { status: "ready", userId: "test-user", email: EMAIL, isAnonymous: false }
        : { status: "ready", userId: "test-user", email: null, isAnonymous: true },
    );
  jest.mocked(captureService.allowance).mockResolvedValue(kind === "registered" ? registeredAllowance : anonymousAllowance);
}

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(null);
  installFakeNotebooks([histoire]);
  service = installFakeAccount();
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  signedInAs("registered");
});

afterEach(() => {
  alert.mockRestore();
});

async function openAccount(): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl: "/account" });
  await app;
  return () => app.getPathname();
}

function confirmDeletion(): Promise<void> {
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  const confirm = buttons.find((button) => button.style === "destructive");
  return act(async () => {
    confirm?.onPress?.();
  });
}

describe("the account of a registered user", () => {
  test("shows the e-mail, the pages of the month, the two documents, the sign-out and the deletion with its warning", async () => {
    await openAccount();

    expect(screen.getByText(fr.account.email)).toBeTruthy();
    expect(await screen.findByText(EMAIL)).toBeTruthy();
    expect(screen.getByText(fr.account.pagesMonth)).toBeTruthy();
    expect(await screen.findByText(fr.account.pagesCount(9, 15))).toBeTruthy();
    expect(screen.getByText(fr.account.terms)).toBeTruthy();
    expect(screen.getByText(fr.account.privacy)).toBeTruthy();
    expect(screen.getByText(fr.account.signOut)).toBeTruthy();
    expect(screen.getByText(fr.account.delete)).toBeTruthy();
    expect(screen.getByText(fr.account.deleteNote)).toBeTruthy();
  });

  test("offers neither a sign-up nor trial pages", async () => {
    await openAccount();
    await screen.findByText(EMAIL);

    expect(screen.queryByText(fr.account.createAccount)).toBeNull();
    expect(screen.queryByText(fr.account.pagesTrial)).toBeNull();
  });

  test("opens the terms and the privacy policy from their rows", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await openAccount();

    await fireEvent.press(screen.getByText(fr.account.terms));
    expect(open).toHaveBeenLastCalledWith(legalLinks.terms);
    await fireEvent.press(screen.getByText(fr.account.privacy));
    expect(open).toHaveBeenLastCalledWith(legalLinks.privacy);
    open.mockRestore();
  });

  test("signs out, then shows the library", async () => {
    const pathname = await openAccount();

    await fireEvent.press(screen.getByText(fr.account.signOut));

    expect(service.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pathname()).toBe("/"));
  });

  test("says when the sign-out did not work and stays on the account", async () => {
    service.signOut.mockResolvedValue(refused("failed"));
    const pathname = await openAccount();

    await fireEvent.press(screen.getByText(fr.account.signOut));

    expect(await screen.findByText(fr.account.signOutFailed)).toBeTruthy();
    expect(pathname()).toBe("/account");
  });

  test("asks for a confirmation before deleting anything", async () => {
    await openAccount();

    await fireEvent.press(screen.getByText(fr.account.delete));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe(fr.account.deleteConfirmTitle);
    expect(alert.mock.calls[0][1]).toBe(fr.account.deleteConfirmBody);
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(buttons.map((button) => [button.text, button.style])).toEqual([
      [fr.common.cancel, "cancel"],
      [fr.account.deleteConfirm, "destructive"],
    ]);
    expect(service.deleteAccount).not.toHaveBeenCalled();
  });

  test("deletes nothing when the confirmation is cancelled", async () => {
    const pathname = await openAccount();
    await fireEvent.press(screen.getByText(fr.account.delete));

    const buttons = alert.mock.calls[0][2] as AlertButton[];
    await act(async () => {
      buttons.find((button) => button.style === "cancel")?.onPress?.();
    });

    expect(service.deleteAccount).not.toHaveBeenCalled();
    expect(pathname()).toBe("/account");
  });

  test("deletes the account once confirmed, then shows the library", async () => {
    const pathname = await openAccount();
    await fireEvent.press(screen.getByText(fr.account.delete));

    await confirmDeletion();

    expect(service.deleteAccount).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pathname()).toBe("/"));
  });

  test.each([
    ["failed", fr.account.deleteFailed],
    ["offline", fr.account.deleteOffline],
  ] as const)("says when the deletion did not work (%s) and keeps the account", async (reason, message) => {
    service.deleteAccount.mockResolvedValue(refused(reason));
    const pathname = await openAccount();
    await fireEvent.press(screen.getByText(fr.account.delete));

    await confirmDeletion();

    expect(await screen.findByText(message)).toBeTruthy();
    expect(pathname()).toBe("/account");
    expect(screen.getByText(EMAIL)).toBeTruthy();
  });

  test("lets nothing else be done while the account is being deleted", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    service.deleteAccount.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openAccount();
    await fireEvent.press(screen.getByText(fr.account.delete));
    await confirmDeletion();

    await fireEvent.press(screen.getByText(fr.account.signOut));
    await fireEvent.press(screen.getByText(fr.account.delete));

    expect(service.signOut).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
  });

  test("is written in English on a phone in English", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openAccount();

    expect(screen.getByText(en.account.signOut)).toBeTruthy();
    expect(await screen.findByText(en.account.pagesCount(9, 15))).toBeTruthy();
  });

  test("closes with OK", async () => {
    const pathname = await openAccount();

    await fireEvent.press(screen.getByText(fr.common.done));

    await waitFor(() => expect(pathname()).toBe("/"));
  });
});

describe("the account of a user who has not signed up", () => {
  beforeEach(() => {
    signedInAs("anonymous");
  });

  test("shows the trial pages, the two documents and the deletion", async () => {
    await openAccount();

    expect(screen.getByText(fr.account.pagesTrial)).toBeTruthy();
    expect(await screen.findByText(fr.account.pagesCount(1, 3))).toBeTruthy();
    expect(screen.getByText(fr.account.terms)).toBeTruthy();
    expect(screen.getByText(fr.account.privacy)).toBeTruthy();
    expect(screen.getByText(fr.account.delete)).toBeTruthy();
    expect(screen.getByText(fr.account.deleteNote)).toBeTruthy();
  });

  test("shows no e-mail, no month of pages and no sign-out", async () => {
    await openAccount();
    await screen.findByText(fr.account.pagesCount(1, 3));

    expect(screen.queryByText(fr.account.email)).toBeNull();
    expect(screen.queryByText(fr.account.pagesMonth)).toBeNull();
    expect(screen.queryByText(fr.account.signOut)).toBeNull();
  });

  test("offers to create an account in place of the sign-out", async () => {
    const pathname = await openAccount();

    await fireEvent.press(screen.getByText(fr.account.createAccount));

    await waitFor(() => expect(pathname()).toBe("/sign-in"));
  });

  test("deletes the account after the same confirmation", async () => {
    const pathname = await openAccount();
    await fireEvent.press(screen.getByText(fr.account.delete));

    await confirmDeletion();

    expect(service.deleteAccount).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pathname()).toBe("/"));
  });
});
