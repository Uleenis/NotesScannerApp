import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { QueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { pageService } from "@/pages/service";
import { installFakeAccount, refused } from "./fake-account-service";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { installFakePages, page } from "./fake-page-service";
import { phoneLocale } from "./phone-locale";

const mockListeners: ((change: { userId: string; email: string | null; isAnonymous: boolean } | null) => void)[] = [];

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("@/pages/timing", () => require("./fake-page-service").timing);
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: {
    watch: (listener: (change: { userId: string; email: string | null; isAnonymous: boolean } | null) => void) => {
      mockListeners.push(listener);
      return () => undefined;
    },
    ensureSession: jest.fn(),
    syncLanguage: jest.fn(),
  },
}));
jest.mock("@/auth/account-service", () => require("./account-service-module").accountServiceModule);
jest.mock("@/lib/query-client", () => {
  const actual = jest.requireActual<typeof import("@/lib/query-client")>("@/lib/query-client");
  const { QueryClient } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, createQueryClient: () => new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock("@/notebooks/service", () => ({ notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn() } }));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(), count: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn() },
}));

const fr = strings.fr;

const EMAIL = "reader@example.test";

const anonymous: Allowance = { isAnonymous: true, used: 1, max: 3, remaining: 2, resetsAt: null, blockedReason: null };
const registered: Allowance = { isAnonymous: false, used: 1, max: 15, remaining: 14, resetsAt: null, blockedReason: null };

let service: ReturnType<typeof installFakeAccount>;

beforeEach(() => {
  mockListeners.length = 0;
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(anonymous);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(null);
  installFakeNotebooks([histoire]);
  installFakePages([]);
  jest.mocked(pageService.count).mockResolvedValue(0);
  service = installFakeAccount();
});

async function openCode(mode: "signup" | "signin" = "signup"): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl: `/sign-in/code?email=${encodeURIComponent(EMAIL)}&mode=${mode}` });
  await app;
  return () => app.getPathname();
}

function typeCode(code: string) {
  return fireEvent.changeText(screen.getByLabelText(fr.code.label), code);
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("the code screen", () => {
  test("shows where the code was sent and that the code is valid for 10 minutes", async () => {
    await openCode();

    expect(screen.getByText(fr.code.title)).toBeTruthy();
    expect(screen.getByText(fr.code.body(EMAIL))).toBeTruthy();
    expect(screen.getByLabelText(fr.code.label)).toBeTruthy();
  });

  test("checks a sign-up code at the sixth digit, without any button", async () => {
    await openCode("signup");

    await typeCode("12345");
    expect(service.confirmSignUp).not.toHaveBeenCalled();
    await typeCode("123456");

    expect(service.confirmSignUp).toHaveBeenCalledTimes(1);
    expect(service.confirmSignUp).toHaveBeenCalledWith(EMAIL, "123456");
    expect(service.confirmSignIn).not.toHaveBeenCalled();
  });

  test("checks a sign-in code at the sixth digit, saying that this phone has an anonymous account", async () => {
    await openCode("signin");

    await typeCode("123456");

    expect(service.confirmSignIn).toHaveBeenCalledTimes(1);
    expect(service.confirmSignIn).toHaveBeenCalledWith(EMAIL, "123456", true);
    expect(service.confirmSignUp).not.toHaveBeenCalled();
  });

  test("closes every screen of the sign-in once the code is right", async () => {
    const pathname = await openCode("signup");

    await typeCode("123456");

    await waitFor(() => expect(pathname()).toBe("/"));
  });

  test.each([
    ["wrong_code", fr.accountErrors.wrong_code],
    ["too_many", fr.accountErrors.too_many],
    ["offline", fr.accountErrors.offline],
    ["failed", fr.accountErrors.failed],
  ] as const)("says why the code did not work (%s), empties the field and stays on the screen", async (reason, message) => {
    service.confirmSignUp.mockResolvedValue(refused(reason));
    const pathname = await openCode("signup");

    await typeCode("123456");

    expect(await screen.findByText(message)).toBeTruthy();
    expect(pathname()).toBe("/sign-in/code");
    expect(screen.getByLabelText(fr.code.label).props.value).toBe("");
  });

  test("checks a second code typed after a wrong one", async () => {
    service.confirmSignUp.mockResolvedValueOnce(refused("wrong_code")).mockResolvedValueOnce({ ok: true });
    const pathname = await openCode("signup");
    await typeCode("111111");
    await screen.findByText(fr.accountErrors.wrong_code);

    await typeCode("222222");

    expect(service.confirmSignUp).toHaveBeenCalledTimes(2);
    expect(service.confirmSignUp).toHaveBeenLastCalledWith(EMAIL, "222222");
    await waitFor(() => expect(pathname()).toBe("/"));
  });

  test("removes the message as soon as a new digit is typed", async () => {
    service.confirmSignUp.mockResolvedValue(refused("wrong_code"));
    await openCode("signup");
    await typeCode("111111");
    await screen.findByText(fr.accountErrors.wrong_code);

    await typeCode("2");

    expect(screen.queryByText(fr.accountErrors.wrong_code)).toBeNull();
  });

  test("takes no typing while the code is being checked, and checks it once", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    service.confirmSignUp.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openCode("signup");

    await typeCode("123456");
    expect(screen.getByLabelText(fr.code.label).props.editable).toBe(false);
    await typeCode("654321");

    expect(service.confirmSignUp).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
  });
});

describe("asking for the code again", () => {
  test("is not possible before 30 seconds, and says how long to wait", async () => {
    await openCode("signup");

    expect(screen.getByText(fr.code.resendIn(30))).toBeTruthy();
    expect(screen.getByText(fr.code.nothingReceived, { exact: false })).toBeTruthy();

    await advance(12_000);
    expect(screen.getByText(fr.code.resendIn(18))).toBeTruthy();

    await advance(17_000);
    expect(screen.getByText(fr.code.resendIn(1))).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.code.resendIn(1)));
    expect(service.startSignUp).not.toHaveBeenCalled();
    expect(screen.queryByText(fr.code.resend)).toBeNull();
  });

  test("becomes possible after 30 seconds", async () => {
    await openCode("signup");

    await advance(30_000);

    expect(screen.getByText(fr.code.resend)).toBeTruthy();
    expect(screen.queryByText(fr.code.resendIn(1))).toBeNull();
  });

  test("sends a new sign-up code, says so and waits another 30 seconds", async () => {
    await openCode("signup");
    await advance(30_000);

    await fireEvent.press(screen.getByText(fr.code.resend));

    expect(service.startSignUp).toHaveBeenCalledTimes(1);
    expect(service.startSignUp).toHaveBeenCalledWith(EMAIL);
    expect(await screen.findByText(fr.code.resent)).toBeTruthy();
    expect(screen.getByText(fr.code.resendIn(30))).toBeTruthy();
    await advance(29_000);
    expect(screen.queryByText(fr.code.resend)).toBeNull();
    await advance(1_000);
    expect(screen.getByText(fr.code.resend)).toBeTruthy();
  });

  test("sends a new sign-in code the same way", async () => {
    await openCode("signin");
    await advance(30_000);

    await fireEvent.press(screen.getByText(fr.code.resend));

    expect(service.startSignIn).toHaveBeenCalledTimes(1);
    expect(service.startSignIn).toHaveBeenCalledWith(EMAIL);
    expect(service.startSignUp).not.toHaveBeenCalled();
  });

  test("says why when no new code could be sent, and lets the countdown go on", async () => {
    service.startSignUp.mockResolvedValue(refused("too_many"));
    await openCode("signup");
    await advance(30_000);

    await fireEvent.press(screen.getByText(fr.code.resend));

    expect(await screen.findByText(fr.accountErrors.too_many)).toBeTruthy();
    expect(screen.queryByText(fr.code.resent)).toBeNull();
    expect(screen.getByText(fr.code.resend)).toBeTruthy();
  });

  test("goes back to the e-mail screen with the address still there", async () => {
    const pathname = await openCode("signup");

    await act(async () => router.back());

    await waitFor(() => expect(pathname()).toBe("/sign-in"));
  });
});

describe("closing the sign-in after the code is right", () => {
  test.each([
    ["the account screen", "/account", () => router.push("/account")],
    ["a notebook", `/notebook/${histoire.id}`, () => router.push({ pathname: "/notebook/[id]", params: { id: histoire.id } })],
  ])("goes back to %s when the sign-in was opened from there", async (_name, expected, openOrigin) => {
    const pathname = await openLibrary();
    await act(async () => openOrigin());
    await act(async () => router.push("/sign-in"));
    await fireEvent.changeText(screen.getByLabelText(fr.signIn.emailLabel), EMAIL);
    await fireEvent.press(screen.getByText(fr.signIn.receiveCode));
    await waitFor(() => expect(pathname()).toBe("/sign-in/code"));

    await typeCode("123456");

    await waitFor(() => expect(pathname()).toBe(expected));
  });
});

describe("after the sign-up", () => {
  test("the reminder of the library goes away and the limits are read again for the same account", async () => {
    installFakePages([page({ id: "kept-page", notebookId: histoire.id, number: 1 })]);
    const pathname = await openLibrary();
    expect(await screen.findByText(fr.library.anonymousReminder)).toBeTruthy();
    const readsBefore = jest.mocked(captureService.allowance).mock.calls.length;

    await act(async () => router.push("/sign-in"));
    await fireEvent.changeText(screen.getByLabelText(fr.signIn.emailLabel), EMAIL);
    await fireEvent.press(screen.getByText(fr.signIn.receiveCode));
    await waitFor(() => expect(pathname()).toBe("/sign-in/code"));
    jest.mocked(captureService.allowance).mockResolvedValue(registered);
    service.confirmSignUp.mockImplementation(async () => {
      for (const listener of mockListeners) {
        listener({ userId: "test-user", email: EMAIL, isAnonymous: false });
      }
      return { ok: true };
    });
    await typeCode("123456");

    await waitFor(() => expect(pathname()).toBe("/"));
    await waitFor(() => expect(screen.queryByText(fr.library.anonymousReminder)).toBeNull());
    expect(jest.mocked(captureService.allowance).mock.calls.length).toBeGreaterThan(readsBefore);
    expect(screen.getByText(histoire.name)).toBeTruthy();
  });
});

const PENDING = { pages: 2, session: { accessToken: "found-access", refreshToken: "found-refresh", userId: "found-user" } };

describe("joining the pages of this phone to the account found", () => {
  beforeEach(() => {
    service.confirmSignIn.mockResolvedValue({ ok: true, transfer: PENDING });
  });

  test("says that the pages are joining the account, takes no more typing, and asks for the transfer", async () => {
    let finish: (value: { ok: true; userId: string }) => void = () => undefined;
    service.completeTransfer.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const pathname = await openCode("signin");

    await typeCode("123456");

    expect(await screen.findByText(fr.code.transferring(2))).toBeTruthy();
    expect(fr.code.transferring(2)).toBe("Les 2 pages de ce téléphone rejoignent ton compte.");
    expect(service.completeTransfer).toHaveBeenCalledTimes(1);
    expect(service.completeTransfer).toHaveBeenCalledWith(PENDING);
    expect(screen.queryByLabelText(fr.code.label)).toBeNull();
    expect(screen.queryByText(fr.code.nothingReceived, { exact: false })).toBeNull();
    expect(pathname()).toBe("/sign-in/code");

    await act(async () => finish({ ok: true, userId: "found-user" }));
    await waitFor(() => expect(pathname()).toBe("/"));
  });

  test("speaks of one page in the singular, in French and in English", async () => {
    service.confirmSignIn.mockResolvedValue({ ok: true, transfer: { ...PENDING, pages: 1 } });
    service.completeTransfer.mockReturnValue(new Promise(() => undefined));
    await openCode("signin");

    await typeCode("123456");

    expect(await screen.findByText(fr.code.transferring(1))).toBeTruthy();
    expect(fr.code.transferring(1)).toBe("La page de ce téléphone rejoint ton compte.");
    expect(strings.en.code.transferring(1)).toBe("The page on this phone is joining your account.");
    expect(strings.en.code.transferring(2)).toBe("The 2 pages on this phone are joining your account.");
  });

  test("closes the sign-in and shows the pages of the account found", async () => {
    installFakePages([page({ id: "joined-page", notebookId: histoire.id, number: 1 })]);
    const pathname = await openLibrary();
    await act(async () => router.push("/sign-in"));
    await fireEvent.changeText(screen.getByLabelText(fr.signIn.emailLabel), EMAIL);
    await fireEvent.press(screen.getByText(fr.signIn.signInLink));
    await fireEvent.press(screen.getByText(fr.signIn.receiveCode));
    await waitFor(() => expect(pathname()).toBe("/sign-in/code"));
    service.completeTransfer.mockImplementation(async () => {
      for (const listener of mockListeners) {
        listener({ userId: "found-user", email: EMAIL, isAnonymous: false });
      }
      return { ok: true, userId: "found-user" };
    });
    const listsBefore = jest.mocked(pageService.list).mock.calls.length;

    await typeCode("123456");

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(await screen.findByText(histoire.name)).toBeTruthy();
    expect(jest.mocked(pageService.list).mock.calls.length).toBeGreaterThan(listsBefore);
  });

  test("reads again the pages, the notebooks and the limits of the account found, and of no other", async () => {
    const reload = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const pathname = await openCode("signin");

    await typeCode("123456");

    await waitFor(() => expect(pathname()).toBe("/"));
    const keys = reload.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    for (const name of ["pages", "notebooks", "notebook", "allowance", "latest-notebook"]) {
      expect(keys).toContain(JSON.stringify([name, "found-user"]));
    }
    expect(keys).not.toContain(JSON.stringify(["pages", "test-user"]));
    reload.mockRestore();
  });

  test.each([
    ["reading_in_progress", fr.accountErrors.reading_in_progress],
    ["offline", fr.accountErrors.offline],
    ["failed", fr.accountErrors.failed],
  ] as const)("says why the transfer did not work (%s), says that nothing is lost and offers to try again", async (reason, message) => {
    service.completeTransfer.mockResolvedValue(refused(reason));
    const pathname = await openCode("signin");

    await typeCode("123456");

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText(fr.code.transferKept)).toBeTruthy();
    expect(screen.getByText(fr.common.retry)).toBeTruthy();
    expect(pathname()).toBe("/sign-in/code");
  });

  test("tries again without asking for a new code and finishes", async () => {
    service.completeTransfer.mockResolvedValueOnce(refused("offline")).mockResolvedValueOnce({ ok: true, userId: "found-user" });
    const pathname = await openCode("signin");
    await typeCode("123456");
    await screen.findByText(fr.accountErrors.offline);

    await fireEvent.press(screen.getByText(fr.common.retry));

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(service.completeTransfer).toHaveBeenCalledTimes(2);
    expect(service.completeTransfer).toHaveBeenLastCalledWith(PENDING);
    expect(service.confirmSignIn).toHaveBeenCalledTimes(1);
  });

  test("shows the sentence again, and no failure, while it tries again", async () => {
    service.completeTransfer.mockResolvedValueOnce(refused("offline")).mockReturnValueOnce(new Promise(() => undefined));
    await openCode("signin");
    await typeCode("123456");
    await screen.findByText(fr.accountErrors.offline);

    await fireEvent.press(screen.getByText(fr.common.retry));

    expect(await screen.findByText(fr.code.transferring(2))).toBeTruthy();
    expect(screen.queryByText(fr.accountErrors.offline)).toBeNull();
    expect(screen.queryByText(fr.common.retry)).toBeNull();
  });

  test("does not start a second transfer when the button is pressed twice in the same instant", async () => {
    service.completeTransfer.mockResolvedValueOnce(refused("offline")).mockReturnValueOnce(new Promise(() => undefined));
    await openCode("signin");
    await typeCode("123456");
    await screen.findByText(fr.accountErrors.offline);
    const retry = screen.getByText(fr.common.retry);

    await act(async () => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });

    expect(service.completeTransfer).toHaveBeenCalledTimes(2);
  });

  test("closes at once, with no sentence and no transfer, when there is nothing to bring", async () => {
    service.confirmSignIn.mockResolvedValue({ ok: true, transfer: null });
    const pathname = await openCode("signin");

    await typeCode("123456");

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(service.completeTransfer).not.toHaveBeenCalled();
  });
});

async function openLibrary(): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl: "/" });
  await app;
  return () => app.getPathname();
}
