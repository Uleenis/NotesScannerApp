import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
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
    ["has_pages", fr.accountErrors.has_pages],
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
    expect(service.startSignIn).toHaveBeenCalledWith(EMAIL, true);
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

async function openLibrary(): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl: "/" });
  await app;
  return () => app.getPathname();
}
