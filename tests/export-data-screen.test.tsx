import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert, type AlertButton } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { myDataService } from "@/export/data/service";
import { strings } from "@/i18n";
import { installFakeAccount } from "./fake-account-service";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

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
  pageService: { list: jest.fn(async () => []), count: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn(), words: jest.fn(), correct: jest.fn(), edit: jest.fn(), alerts: jest.fn(async () => []), second: jest.fn(async () => null) },
}));
jest.mock("@/export/data/service", () => ({ myDataService: { plan: jest.fn(), write: jest.fn() } }));

const fr = strings.fr;
const en = strings.en;

const allowance: Allowance = { isAnonymous: false, used: 9, max: 15, remaining: 6, resetsAt: null, blockedReason: null };
const identity = { userId: "test-user", email: "reader@example.test", isAnonymous: false };
const plan = { identity, pages: [{ id: "p1" }, { id: "p2" }], estimate: 12_400_000 };

let alert: jest.SpyInstance;

function button(call: number, text: string): AlertButton {
  const found = (alert.mock.calls[call][2] as AlertButton[]).find((candidate) => candidate.text === text);
  if (found === undefined) {
    throw new Error(`no button ${text}`);
  }
  return found;
}

async function openAccount() {
  const app = renderRouter("./src/app", { initialUrl: "/account" });
  await app;
  await screen.findByText(fr.account.pagesCount(9, 15));
}

async function startAndAgree() {
  await openAccount();
  await fireEvent.press(screen.getByText(fr.myData.label));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  await act(async () => {
    button(0, fr.myData.confirm).onPress?.();
  });
}

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", ...identity });
  jest.mocked(captureService.allowance).mockResolvedValue(allowance);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(null);
  jest.mocked(myDataService.plan).mockReset().mockResolvedValue({ status: "ready", plan });
  jest.mocked(myDataService.write).mockReset().mockResolvedValue({ status: "shared" });
  installFakeNotebooks([histoire]);
  installFakeAccount();
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

afterEach(() => {
  alert.mockRestore();
});

describe("the export of my data", () => {
  test("is offered on the account, with its explanation", async () => {
    await openAccount();

    expect(screen.getByText(fr.myData.label)).toBeTruthy();
    expect(screen.getByText(fr.myData.note)).toBeTruthy();
  });

  test("is offered to an anonymous account too", async () => {
    jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
    jest.mocked(captureService.allowance).mockResolvedValue({ ...allowance, isAnonymous: true, used: 1, max: 3, remaining: 2 });
    await renderRouter("./src/app", { initialUrl: "/account" });
    await screen.findByText(fr.account.pagesCount(1, 3));

    expect(screen.getByText(fr.myData.label)).toBeTruthy();
  });

  test("announces the pages and the approximate size, and writes nothing until the user agrees", async () => {
    await openAccount();

    await fireEvent.press(screen.getByText(fr.myData.label));

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(myDataService.plan).toHaveBeenCalledWith(identity, expect.objectContaining({ cancelled: false }));
    expect(alert.mock.calls[0][0]).toBe(fr.myData.confirmTitle);
    expect(alert.mock.calls[0][1]).toBe(fr.myData.confirmBody(2, "12 Mo"));
    expect(myDataService.write).not.toHaveBeenCalled();
  });

  test("writes nothing when the user declines", async () => {
    await openAccount();
    await fireEvent.press(screen.getByText(fr.myData.label));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));

    await act(async () => {
      button(0, fr.common.cancel).onPress?.();
    });

    expect(myDataService.write).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  test("writes the archive once the user agrees, with the allowance, a dated name and a README in both languages", async () => {
    await startAndAgree();

    await waitFor(() => expect(myDataService.write).toHaveBeenCalledTimes(1));
    const [passedPlan, context] = jest.mocked(myDataService.write).mock.calls[0];
    expect(passedPlan).toBe(plan);
    expect(context.allowance).toEqual(allowance);
    expect(context.fileName).toMatch(/^donnees-notes-\d{4}-\d{2}-\d{2}$/);
    expect(context.readme).toContain(en.myData.readme[0]);
    expect(context.readme).toContain(fr.myData.readme[0]);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  test("shows the progress in the wait and cancels the export", async () => {
    let control: { cancelled: boolean } | undefined;
    let report: ((done: number, total: number) => void) | undefined;
    let finish: (() => void) | undefined;
    jest.mocked(myDataService.write).mockImplementation(
      (_plan, _context, given, progress) =>
        new Promise((resolve) => {
          control = given;
          report = progress;
          finish = () => resolve({ status: "cancelled" });
        }),
    );
    await startAndAgree();
    await waitFor(() => expect(report).toBeDefined());

    await act(async () => {
      report?.(1, 2);
    });

    expect(await screen.findByText(fr.myData.progress(1, 2))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(fr.common.cancel));
    expect(control?.cancelled).toBe(true);
    await waitFor(() => expect(screen.queryByText(fr.myData.progress(1, 2))).toBeNull());
    await act(async () => {
      finish?.();
    });
    expect(alert).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["too many pages", { status: "tooMany", max: 10_000 } as const, fr.myData.tooMany(10_000)],
    ["an error while planning", { status: "error" } as const, fr.myData.failed],
  ])("tells the user about %s when planning", async (_, planned, message) => {
    jest.mocked(myDataService.plan).mockResolvedValue(planned);
    await openAccount();

    await fireEvent.press(screen.getByText(fr.myData.label));

    await waitFor(() => expect(alert).toHaveBeenCalledWith(message));
    expect(myDataService.write).not.toHaveBeenCalled();
  });

  test.each([
    ["a lack of room", { status: "noSpace" } as const, fr.myData.noSpace],
    ["an archive too large", { status: "tooLarge" } as const, fr.myData.tooLarge],
    ["sharing that is not available", { status: "unavailable" } as const, fr.export.unavailable],
    ["an error", { status: "error" } as const, fr.myData.failed],
  ])("tells the user about %s when writing", async (_, written, message) => {
    jest.mocked(myDataService.write).mockResolvedValue(written);

    await startAndAgree();

    await waitFor(() => expect(alert).toHaveBeenCalledWith(message));
  });

  test("says nothing after a cancel", async () => {
    jest.mocked(myDataService.write).mockResolvedValue({ status: "cancelled" });

    await startAndAgree();

    await waitFor(() => expect(myDataService.write).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledTimes(1);
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await renderRouter("./src/app", { initialUrl: "/account" });
    await screen.findByText(en.account.pagesCount(9, 15));

    await fireEvent.press(screen.getByText(en.myData.label));

    await waitFor(() => expect(alert).toHaveBeenCalledWith(en.myData.confirmTitle, en.myData.confirmBody(2, "12 MB"), expect.anything(), expect.anything()));
  });
});
