import { useLocales } from "expo-localization";
import { useNetworkState } from "expo-network";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { scanPages, type ScanResult } from "@/capture/scanner";
import type { SendResult } from "@/capture/send-page";
import { captureService } from "@/capture/service";
import type { SharpnessCheck } from "@/capture/sharpness";
import { strings } from "@/i18n";
import { notebookService } from "@/notebooks/service";
import { pageService } from "@/pages/service";
import { deferred } from "./fake-auth-client";
import { histoire, installFakeNotebooks, sciences } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-network", () => ({ useNetworkState: jest.fn() }));
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: {
    watch: () => () => undefined,
    ensureSession: jest.fn(),
    syncLanguage: jest.fn(),
  },
}));
jest.mock("@/lib/query-client", () => {
  const actual = jest.requireActual<typeof import("@/lib/query-client")>("@/lib/query-client");
  const { QueryClient } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, createQueryClient: () => new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock("@/notebooks/service", () => ({
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn(), chapters: jest.fn(async () => []) },
}));
jest.mock("@/capture/scanner", () => ({
  ...jest.requireActual<typeof import("@/capture/scanner")>("@/capture/scanner"),
  scanPages: jest.fn(),
}));
jest.mock("@/capture/service", () => ({
  captureService: {
    allowance: jest.fn(),
    latestNotebookId: jest.fn(),
    send: jest.fn(),
    prepareScan: jest.fn(),
    discardPhoto: jest.fn(),
    checkSharpness: jest.fn(),
  },
}));

jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(async () => []), get: jest.fn(() => new Promise(() => {})), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn(), words: jest.fn(async () => ({ words: [], corrections: [], gaps: [] })), correct: jest.fn(), edit: jest.fn(), alerts: jest.fn(async () => []), second: jest.fn(async () => null) },
}));

const fr = strings.fr;
const en = strings.en;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };
const monthly: Allowance = { ...open, used: 15, remaining: 0, blockedReason: "monthly_limit" };
const trial: Allowance = { isAnonymous: true, used: 3, max: 3, remaining: 0, resetsAt: null, blockedReason: "anonymous_limit" };
const daily: Allowance = { isAnonymous: true, used: 0, max: 3, remaining: 3, resetsAt: null, blockedReason: "anonymous_daily_cap" };

const online = { isConnected: true, isInternetReachable: true };
const offline = { isConnected: false, isInternetReachable: false };

const never = <T,>() => new Promise<T>(() => {});

const cancelled: ScanResult = { status: "cancelled" };

function scanned(count: number, first = 1): ScanResult {
  return { status: "scanned", uris: Array.from({ length: count }, (_, index) => `file:///cache/scans/s${first + index}.jpg`) };
}

function ready(position: number): string {
  return `file:///cache/ready/r${position}.jpg`;
}

const sharpness: Record<string, SharpnessCheck> = {};

let alert: jest.SpyInstance;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(useNetworkState).mockReturnValue(online);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  jest.mocked(captureService.send).mockReset().mockImplementation(async (input) => ({ status: "sent", pageId: `page-${input.photoUri.replace(/\D/g, "")}` }));
  jest.mocked(captureService.prepareScan).mockReset().mockImplementation(async (uri) => uri.replace("scans/s", "ready/r"));
  jest.mocked(captureService.discardPhoto).mockReset();
  Object.keys(sharpness).forEach((key) => delete sharpness[key]);
  jest.mocked(captureService.checkSharpness).mockReset().mockImplementation(async (uri) => sharpness[uri] ?? "sharp");
  jest.mocked(scanPages).mockReset().mockResolvedValue(cancelled);
  jest.mocked(pageService.list).mockResolvedValue([]);
  installFakeNotebooks([histoire, sciences]);
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

afterEach(() => {
  alert.mockRestore();
});

async function openApp(initialUrl = "/"): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return () => app.getPathname();
}

async function loaded(): Promise<void> {
  await waitFor(() => expect(captureService.allowance).toHaveBeenCalled());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20);
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20);
  });
}

async function pressScan(): Promise<void> {
  await fireEvent.press(await screen.findByText(fr.common.scan));
  await settle();
}

async function openCapture(): Promise<() => string> {
  const pathname = await openApp("/");
  await screen.findByText(histoire.name);
  await loaded();
  await pressScan();
  return pathname;
}

function sent(): string[] {
  return jest.mocked(captureService.send).mock.calls.map(([input]) => input.photoUri);
}

function discarded(): string[] {
  return jest.mocked(captureService.discardPhoto).mock.calls.map(([uri]) => uri);
}

async function confirmLeave(): Promise<void> {
  const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as { style?: string; onPress?: () => void }[];
  const confirm = buttons.find((button) => button.style === "destructive");
  await act(async () => {
    confirm?.onPress?.();
  });
}

test("scan opens the scanner at once, in the notebook of the last page", async () => {
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
  expect(scanPages).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText(fr.capture.notebookLabel)).toHaveTextContent(histoire.name, { exact: false });
  expect(screen.getByText(fr.capture.hint)).toBeTruthy();
});

test.each([
  [13, 13],
  [2, 2],
  [400, 20],
])("the scanner is asked for the smaller of the pages left (%i) and 20 [2]", async (remaining, limit) => {
  jest.mocked(captureService.allowance).mockResolvedValue({ ...open, remaining });
  await openCapture();

  expect(scanPages).toHaveBeenCalledWith({ limit });
});

test("the scanner opens when the limits could not be read: the server stays the authority", async () => {
  jest.mocked(captureService.allowance).mockRejectedValue(new Error("offline"));
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
  expect(scanPages).toHaveBeenCalledWith({ limit: 20 });
});

test("the monthly limit opens its sheet before the scanner, with the date of the reset [22]", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue(monthly);
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
  expect(screen.getByText(fr.limit.monthTitle(15))).toBeTruthy();
  expect(screen.getByText(fr.limit.monthBody(10))).toHaveTextContent("1er novembre", { exact: false });
  expect(screen.getByText(fr.limit.understood)).toBeTruthy();
  expect(screen.queryByText(fr.limit.createAccount)).toBeNull();
  expect(scanPages).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText(fr.limit.understood));
  expect(pathname()).toBe("/");
});

test("the three trial pages read open the account sheet before the scanner [22]", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue(trial);
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
  expect(screen.getByText(fr.limit.accountTitle)).toBeTruthy();
  expect(screen.getByText(fr.limit.trialBody(3, 15))).toBeTruthy();
  expect(screen.getByText(fr.limit.later)).toBeTruthy();
  expect(scanPages).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText(fr.limit.later));
  expect(pathname()).toBe("/");
});

test("the daily cap of the anonymous accounts opens the account sheet with its own sentence [22]", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue(daily);
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
  expect(screen.getByText(fr.limit.dailyBody)).toBeTruthy();
  expect(screen.queryByText(fr.limit.trialBody(3, 15))).toBeNull();
  expect(scanPages).not.toHaveBeenCalled();
});

test("create an account on the sheet opens the sign-in screen", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue(trial);
  const pathname = await openCapture();

  await fireEvent.press(screen.getByText(fr.limit.createAccount));
  expect(pathname()).toBe("/sign-in");
});

test("the sheets speak English on an English phone", async () => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  jest.mocked(captureService.allowance).mockResolvedValue(monthly);
  await openApp("/");
  await screen.findByText(en.common.scan);
  await loaded();
  await fireEvent.press(screen.getByText(en.common.scan));
  await settle();

  expect(screen.getByText(en.limit.monthTitle(15))).toBeTruthy();
  expect(screen.getByText(en.limit.monthBody(10))).toHaveTextContent("November 1", { exact: false });
});

test("the limits are read again at the tap on scan: a limit reached since the last reading opens its sheet", async () => {
  jest.mocked(captureService.allowance).mockResolvedValueOnce(open).mockResolvedValue(monthly);
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
  expect(scanPages).not.toHaveBeenCalled();
});

test("a limit that is gone since the last reading lets the scanner open", async () => {
  jest.mocked(captureService.allowance).mockResolvedValueOnce(monthly).mockResolvedValue(open);
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
  expect(scanPages).toHaveBeenCalled();
});

test("when the new reading of the limits fails, the limits known before are used", async () => {
  jest.mocked(captureService.allowance).mockResolvedValueOnce(monthly).mockRejectedValue(new Error("offline"));
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
});

test("when the new reading of the limits does not answer, the limits known before are used after a short wait", async () => {
  jest.mocked(captureService.allowance).mockResolvedValueOnce(monthly).mockReturnValue(never());
  const pathname = await openApp("/");
  await screen.findByText(histoire.name);
  await loaded();
  await fireEvent.press(await screen.findByText(fr.common.scan));
  expect(pathname()).toBe("/");
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });

  expect(pathname()).toBe("/limit");
});

test("two quick taps on scan open one capture and one scanner", async () => {
  const pathname = await openApp("/");
  await screen.findByText(histoire.name);
  await loaded();
  const fetching = deferred<Allowance>();
  jest.mocked(captureService.allowance).mockReturnValue(fetching.promise);
  await fireEvent.press(await screen.findByText(fr.common.scan));
  await fireEvent.press(screen.getByText(fr.common.scan));
  await act(async () => fetching.resolve(open));
  await settle();

  expect(pathname()).toBe("/capture");
  expect(scanPages).toHaveBeenCalledTimes(1);
});

test("without a network the capture is blocked with its message and the scanner stays closed [28]", async () => {
  jest.mocked(useNetworkState).mockReturnValue(offline);
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
  expect(await screen.findByText(fr.capture.noConnection)).toBeTruthy();
  expect(scanPages).not.toHaveBeenCalled();
});

test("a network that is connected is not taken for a lost one, even if the internet is not confirmed", async () => {
  jest.mocked(useNetworkState).mockReturnValue({ isConnected: true, isInternetReachable: false });
  await openCapture();

  expect(scanPages).toHaveBeenCalled();
  expect(screen.queryByText(fr.capture.noConnection)).toBeNull();
});

test("an unknown network state does not block the scanner", async () => {
  jest.mocked(useNetworkState).mockReturnValue({});
  await openCapture();

  expect(scanPages).toHaveBeenCalled();
});

test("offline, the message and the cancel button show at once, without waiting for the last notebook [28]", async () => {
  jest.mocked(useNetworkState).mockReturnValue(offline);
  jest.mocked(captureService.latestNotebookId).mockReturnValue(never());
  await openCapture();

  expect(await screen.findByText(fr.capture.noConnection)).toBeTruthy();
  expect(screen.getByText(fr.common.cancel)).toBeTruthy();
});

test("a capture opened from a notebook does not wait for the last notebook", async () => {
  jest.mocked(captureService.latestNotebookId).mockReturnValue(never());
  await openApp(`/notebook/${sciences.id}`);
  await screen.findByText(fr.notebook.emptyTitle);
  await loaded();
  await pressScan();

  expect(await screen.findByLabelText(fr.capture.notebookLabel)).toHaveTextContent(sciences.name, { exact: false });
  expect(scanPages).toHaveBeenCalled();
});

test("while the last notebook is awaited the cancel button is there, and after a short wait the first notebook is used", async () => {
  jest.mocked(captureService.latestNotebookId).mockReturnValue(never());
  await openCapture();

  expect(screen.getByText(fr.common.cancel)).toBeTruthy();
  expect(scanPages).not.toHaveBeenCalled();

  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });

  expect(scanPages).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText(fr.capture.notebookLabel)).toHaveTextContent(histoire.name, { exact: false });
});

test("a last notebook that cannot be read opens the scanner for the first notebook at once", async () => {
  jest.mocked(captureService.latestNotebookId).mockRejectedValue(new Error("boom"));
  await openCapture();

  expect(await screen.findByLabelText(fr.capture.notebookLabel)).toHaveTextContent(histoire.name, { exact: false });
  expect(scanPages).toHaveBeenCalled();
});

test("notebooks that cannot be read give a message with a cancel button and a retry, never a blank screen", async () => {
  jest.mocked(notebookService.list).mockRejectedValue(new Error("boom"));
  await openApp("/capture");

  expect(await screen.findByText(fr.library.loadFailed)).toBeTruthy();
  expect(screen.getByText(fr.common.cancel)).toBeTruthy();

  jest.mocked(notebookService.list).mockResolvedValue([histoire, sciences]);
  await fireEvent.press(screen.getByText(fr.common.retry));
  await settle();

  expect(scanPages).toHaveBeenCalled();
});

test("a counter shows at three pages left, in pages of the month for an account", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue({ ...open, remaining: 3 });
  await openCapture();

  expect(await screen.findByText(fr.capture.counterMonth(3))).toBeTruthy();
});

test("no counter above three pages left", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue({ ...open, remaining: 4 });
  await openCapture();

  expect(screen.queryByText(/Plus que/)).toBeNull();
});

test("an anonymous account counts its trial pages", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue({ ...open, isAnonymous: true, max: 3, remaining: 2, resetsAt: null });
  await openCapture();

  expect(await screen.findByText(fr.capture.counterTrial(2))).toBeTruthy();
});

test("the first notebook is used when no page was ever taken", async () => {
  jest.mocked(captureService.latestNotebookId).mockResolvedValue(null);
  await openCapture();

  expect(await screen.findByLabelText(fr.capture.notebookLabel)).toHaveTextContent(histoire.name, { exact: false });
});

test("a scan from a notebook opens the capture in that notebook, and the pages go there", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(1));
  await openApp(`/notebook/${sciences.id}`);
  await screen.findByText(fr.notebook.emptyTitle);
  await loaded();
  await pressScan();

  expect(jest.mocked(captureService.send).mock.calls[0][0]).toMatchObject({ notebookId: sciences.id });
});

test("the notebook of the capture can be changed with a tap once the scanner is closed", async () => {
  await openCapture();
  await fireEvent.press(await screen.findByLabelText(fr.capture.notebookLabel));
  await fireEvent.press(await screen.findByText(sciences.name));

  expect(screen.getByLabelText(fr.capture.notebookLabel)).toHaveTextContent(sciences.name, { exact: false });
});

test("cancel closes the capture", async () => {
  const pathname = await openCapture();
  await fireEvent.press(await screen.findByText(fr.common.cancel));

  expect(pathname()).toBe("/");
  expect(alert).not.toHaveBeenCalled();
});

test("a scanner closed without a page creates no page and offers to scan again", async () => {
  await openCapture();

  expect(captureService.send).not.toHaveBeenCalled();
  expect(captureService.prepareScan).not.toHaveBeenCalled();

  jest.mocked(scanPages).mockResolvedValue(scanned(1));
  await fireEvent.press(await screen.findByText(fr.common.scan));
  await settle();

  expect(scanPages).toHaveBeenCalledTimes(2);
  expect(captureService.send).toHaveBeenCalledTimes(1);
});

test("an unavailable scanner is said, and no scan button is offered [10]", async () => {
  jest.mocked(scanPages).mockResolvedValue({ status: "unavailable" });
  await openCapture();

  expect(await screen.findByText(fr.capture.scannerUnavailable)).toBeTruthy();
  expect(screen.queryByText(fr.common.scan)).toBeNull();
  expect(captureService.send).not.toHaveBeenCalled();
});

test("a scanner that fails is said, and can be tried again", async () => {
  jest.mocked(scanPages).mockResolvedValueOnce({ status: "failed" });
  await openCapture();

  expect(await screen.findByText(fr.capture.scannerFailed)).toBeTruthy();

  jest.mocked(scanPages).mockResolvedValue(scanned(1));
  await fireEvent.press(screen.getByText(fr.common.scan));
  await settle();

  expect(captureService.send).toHaveBeenCalledTimes(1);
});

test("while the scanner is open the cancel button leaves, and a late result is erased, not sent [2]", async () => {
  const opened = deferred<ScanResult>();
  jest.mocked(scanPages).mockReturnValue(opened.promise);
  const pathname = await openCapture();

  expect(await screen.findByText(fr.capture.scanning)).toBeTruthy();
  await fireEvent.press(screen.getByText(fr.common.cancel));
  expect(pathname()).toBe("/");

  await act(async () => opened.resolve(scanned(2)));
  await settle();

  expect(captureService.send).not.toHaveBeenCalled();
  expect(captureService.prepareScan).not.toHaveBeenCalled();
  expect(discarded()).toEqual(expect.arrayContaining(["file:///cache/scans/s1.jpg", "file:///cache/scans/s2.jpg"]));
});

test("leaving while the last page is being checked erases the prepared pages and sends nothing", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(2));
  const checking = deferred<SharpnessCheck>();
  jest.mocked(captureService.checkSharpness).mockResolvedValueOnce("sharp").mockReturnValueOnce(checking.promise);
  const pathname = await openCapture();
  await screen.findByText(fr.capture.preparing(2, 2));
  await fireEvent.press(screen.getByText(fr.common.cancel));
  expect(pathname()).toBe("/");

  await act(async () => checking.resolve("sharp"));
  await settle();

  expect(captureService.send).not.toHaveBeenCalled();
  expect(discarded()).toEqual(expect.arrayContaining([ready(1), ready(2)]));
});

test("a series of three pages is prepared, sent in order into the chosen notebook, and opens the notebook [4][17]", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(3));
  const pathname = await openCapture();

  expect(sent()).toEqual([ready(1), ready(2), ready(3)]);
  expect(jest.mocked(captureService.send).mock.calls.map(([input]) => input.notebookId)).toEqual([histoire.id, histoire.id, histoire.id]);
  expect(jest.mocked(captureService.prepareScan).mock.calls.map(([uri]) => uri)).toEqual([
    "file:///cache/scans/s1.jpg",
    "file:///cache/scans/s2.jpg",
    "file:///cache/scans/s3.jpg",
  ]);
  expect(pathname()).toBe(`/notebook/${histoire.id}`);
});

test("a series asked from a chapter goes into that chapter and opens it", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(2));
  const replace = jest.spyOn(router, "replace");
  await openApp(`/capture?notebook=${histoire.id}&chapter=chapter-7`);
  await settle();

  expect(jest.mocked(captureService.send).mock.calls.map(([input]) => input.chapterId)).toEqual(["chapter-7", "chapter-7"]);
  expect(replace).toHaveBeenCalledWith("/chapter/chapter-7");
  replace.mockRestore();
});

test("a series of one page opens the page [17]", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(1));
  const pathname = await openCapture();

  expect(sent()).toEqual([ready(1)]);
  expect(pathname()).toBe("/page/page-1");
});

test("the scanner's files are erased once prepared, and each prepared file once it is sent [6]", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(2));
  await openCapture();

  expect(discarded()).toEqual(
    expect.arrayContaining(["file:///cache/scans/s1.jpg", "file:///cache/scans/s2.jpg", ready(1), ready(2)]),
  );
});

test("the next page waits for the previous one, and a line gives the progress [4]", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(3));
  const first = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValueOnce(first.promise);
  await openCapture();

  expect(await screen.findByText(fr.capture.sendingSeries(1, 3))).toBeTruthy();
  expect(captureService.send).toHaveBeenCalledTimes(1);

  await act(async () => first.resolve({ status: "sent", pageId: "p1" }));
  await settle();

  expect(captureService.send).toHaveBeenCalledTimes(3);
});

test("the preparation shows its progress", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(2));
  const first = deferred<string>();
  jest.mocked(captureService.prepareScan).mockReturnValueOnce(first.promise);
  await openCapture();

  expect(await screen.findByText(fr.capture.preparing(1, 2))).toBeTruthy();
  expect(captureService.send).not.toHaveBeenCalled();

  await act(async () => first.resolve(ready(1)));
  await settle();
  expect(captureService.send).toHaveBeenCalledTimes(2);
});

test("a page that cannot be prepared is left out, the others go, and the screen says so [3]", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(3));
  jest.mocked(captureService.prepareScan).mockImplementation(async (uri) => {
    if (uri.endsWith("s2.jpg")) {
      throw new Error("no memory");
    }
    return uri.replace("scans/s", "ready/r");
  });
  const pathname = await openCapture();

  expect(sent()).toEqual([ready(1), ready(3)]);
  expect(await screen.findByText(fr.capture.leftOut(1))).toBeTruthy();

  await fireEvent.press(screen.getByText(fr.limit.understood));
  expect(pathname()).toBe(`/notebook/${histoire.id}`);
});

test("a page the server cannot read is left out, the next pages go, and the screen says so", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(2));
  jest.mocked(captureService.send).mockResolvedValueOnce({ status: "photo", pageId: "p1" }).mockResolvedValue({ status: "sent", pageId: "p2" });
  const pathname = await openCapture();

  expect(captureService.send).toHaveBeenCalledTimes(2);
  expect(await screen.findByText(fr.capture.leftOut(1))).toBeTruthy();

  await fireEvent.press(screen.getByText(fr.limit.understood));
  expect(pathname()).toBe("/page/p2");
});

test("when no page can be sent the capture stays, says it, and offers to scan again", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(1));
  jest.mocked(captureService.send).mockResolvedValue({ status: "tooLarge", pageId: "p1" });
  const pathname = await openCapture();

  expect(await screen.findByText(fr.capture.leftOut(1))).toBeTruthy();
  expect(pathname()).toBe("/capture");
  expect(screen.getByText(fr.common.scan)).toBeTruthy();
});

describe("blurry pages [8][18]", () => {
  test("a blurry page is listed before anything is sent, and nothing is sent until the choice", async () => {
    sharpness[ready(2)] = "blurry";
    jest.mocked(scanPages).mockResolvedValue(scanned(3));
    await openCapture();

    expect(await screen.findByText(fr.capture.blurryTitle(1))).toBeTruthy();
    expect(screen.getByText(fr.capture.blurryPage(2))).toBeTruthy();
    expect(screen.queryByText(fr.capture.blurryPage(1))).toBeNull();
    expect(captureService.send).not.toHaveBeenCalled();
  });

  test("the sheet counts several blurry pages", async () => {
    sharpness[ready(1)] = "blurry";
    sharpness[ready(3)] = "blurry";
    jest.mocked(scanPages).mockResolvedValue(scanned(3));
    await openCapture();

    expect(await screen.findByText(fr.capture.blurryTitle(2))).toBeTruthy();
    expect(screen.getByText(fr.capture.blurryPage(1))).toBeTruthy();
    expect(screen.getByText(fr.capture.blurryPage(3))).toBeTruthy();
  });

  test("a page that could not be checked is never signalled", async () => {
    sharpness[ready(1)] = "unchecked";
    jest.mocked(scanPages).mockResolvedValue(scanned(2));
    await openCapture();

    expect(screen.queryByText(fr.capture.blurryTitle(1))).toBeNull();
    expect(captureService.send).toHaveBeenCalledTimes(2);
  });

  test("send anyway sends every page, blurry ones included, in order", async () => {
    sharpness[ready(2)] = "blurry";
    jest.mocked(scanPages).mockResolvedValue(scanned(3));
    await openCapture();
    await fireEvent.press(await screen.findByText(fr.capture.sendAnyway));
    await settle();

    expect(sent()).toEqual([ready(1), ready(2), ready(3)]);
  });

  test("scanning a blurry page again asks the scanner for one page and replaces it at the same place", async () => {
    sharpness[ready(2)] = "blurry";
    jest.mocked(scanPages).mockResolvedValueOnce(scanned(3));
    await openCapture();
    jest.mocked(scanPages).mockResolvedValue(scanned(1, 9));
    await fireEvent.press(await screen.findByLabelText(fr.capture.blurryPageLabel(2)));
    await settle();

    expect(scanPages).toHaveBeenLastCalledWith({ limit: 1 });
    expect(sent()).toEqual([ready(1), ready(9), ready(3)]);
    expect(discarded()).toContain(ready(2));
  });

  test("a replacement that is still blurry brings the sheet back", async () => {
    sharpness[ready(2)] = "blurry";
    sharpness[ready(9)] = "blurry";
    jest.mocked(scanPages).mockResolvedValueOnce(scanned(2));
    await openCapture();
    jest.mocked(scanPages).mockResolvedValue(scanned(1, 9));
    await fireEvent.press(await screen.findByLabelText(fr.capture.blurryPageLabel(2)));
    await settle();

    expect(await screen.findByText(fr.capture.blurryTitle(1))).toBeTruthy();
    expect(captureService.send).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText(fr.capture.sendAnyway));
    await settle();
    expect(sent()).toEqual([ready(1), ready(9)]);
  });

  test("a scanner closed without a page keeps the sheet and the page as they were", async () => {
    sharpness[ready(2)] = "blurry";
    jest.mocked(scanPages).mockResolvedValueOnce(scanned(2));
    await openCapture();
    jest.mocked(scanPages).mockResolvedValue(cancelled);
    await fireEvent.press(await screen.findByLabelText(fr.capture.blurryPageLabel(2)));
    await settle();

    expect(await screen.findByText(fr.capture.blurryTitle(1))).toBeTruthy();
    expect(discarded()).not.toContain(ready(2));
    expect(captureService.send).not.toHaveBeenCalled();
  });

  test("leaving the sheet asks first, then erases every page", async () => {
    sharpness[ready(1)] = "blurry";
    jest.mocked(scanPages).mockResolvedValue(scanned(2));
    const pathname = await openCapture();
    await fireEvent.press(await screen.findByText(fr.common.cancel));

    expect(alert).toHaveBeenCalledWith(fr.capture.leaveTitle, fr.capture.leaveBody(2), expect.any(Array));
    expect(pathname()).toBe("/capture");

    await confirmLeave();
    await settle();

    expect(pathname()).toBe("/");
    expect(discarded()).toEqual(expect.arrayContaining([ready(1), ready(2)]));
    expect(captureService.send).not.toHaveBeenCalled();
  });
});

describe("limit reached during a series [5]", () => {
  test("the page after the refusal and every one behind it are not sent, and the screen counts them", async () => {
    jest.mocked(scanPages).mockResolvedValue(scanned(5));
    jest.mocked(captureService.send)
      .mockResolvedValueOnce({ status: "sent", pageId: "p1" })
      .mockResolvedValueOnce({ status: "limit", reason: "monthly_limit", pageId: "p2" });
    const pathname = await openCapture();

    expect(captureService.send).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(fr.capture.notSent(4))).toBeTruthy();
    expect(screen.getByText(fr.limit.monthTitle(15))).toBeTruthy();
    expect(pathname()).toBe("/capture");
    expect(discarded()).toEqual(expect.arrayContaining([ready(1), ready(2), ready(3), ready(4), ready(5)]));

    await fireEvent.press(screen.getByText(fr.limit.understood));
    expect(pathname()).toBe("/page/p1");
  });

  test("the reason of a trial limit is the trial's", async () => {
    jest.mocked(scanPages).mockResolvedValue(scanned(2));
    jest.mocked(captureService.send)
      .mockResolvedValueOnce({ status: "sent", pageId: "p1" })
      .mockResolvedValueOnce({ status: "limit", reason: "anonymous_limit", pageId: "p2" });
    await openCapture();

    expect(await screen.findByText(fr.capture.notSent(1))).toBeTruthy();
    expect(screen.getByText(fr.limit.trialBody(3, 15))).toBeTruthy();
  });

  test("a refusal on the very first page opens the limit sheet, as for one page", async () => {
    jest.mocked(scanPages).mockResolvedValue(scanned(3));
    jest.mocked(captureService.send).mockResolvedValue({ status: "limit", reason: "monthly_limit", pageId: "p1" });
    const pathname = await openCapture();

    expect(captureService.send).toHaveBeenCalledTimes(1);
    expect(pathname()).toBe("/limit");
    expect(discarded()).toEqual(expect.arrayContaining([ready(1), ready(2), ready(3)]));
  });
});

describe("network lost during a series [6][20]", () => {
  async function interrupted(count = 3) {
    jest.mocked(scanPages).mockResolvedValue(scanned(count));
    jest.mocked(captureService.send)
      .mockResolvedValueOnce({ status: "sent", pageId: "p1" })
      .mockResolvedValueOnce({ status: "network", pageId: "p2" });
    const pathname = await openCapture();
    await screen.findByText(fr.capture.interrupted(count - 1));
    return pathname;
  }

  test("the sending stops, the pages not sent stay and are counted", async () => {
    await interrupted();

    expect(captureService.send).toHaveBeenCalledTimes(2);
    expect(discarded()).toContain(ready(1));
    expect(discarded()).not.toContain(ready(2));
    expect(discarded()).not.toContain(ready(3));
  });

  test("try again sends only the pages not sent, and the half-sent page keeps its page, so nothing is doubled", async () => {
    const pathname = await interrupted();
    jest.mocked(captureService.send).mockClear();
    await fireEvent.press(screen.getByText(fr.capture.retry));
    await settle();

    const calls = jest.mocked(captureService.send).mock.calls.map(([input]) => [input.photoUri, input.pageId]);
    expect(calls).toEqual([
      [ready(2), "p2"],
      [ready(3), null],
    ]);
    expect(pathname()).toBe(`/notebook/${histoire.id}`);
  });

  test("a try that fails again keeps the same pages", async () => {
    await interrupted();
    jest.mocked(captureService.send).mockClear();
    jest.mocked(captureService.send).mockResolvedValueOnce({ status: "network", pageId: "p2" });
    await fireEvent.press(screen.getByText(fr.capture.retry));
    await settle();

    expect(captureService.send).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(fr.capture.interrupted(2))).toBeTruthy();
  });

  test("an error that is not a lost network stops the sending the same way", async () => {
    jest.mocked(scanPages).mockResolvedValue(scanned(2));
    jest.mocked(captureService.send).mockRejectedValueOnce(new Error("boom"));
    await openCapture();

    expect(await screen.findByText(fr.capture.interrupted(2))).toBeTruthy();
  });

  test("while the phone is offline the message says so and try again waits", async () => {
    await interrupted();
    jest.mocked(useNetworkState).mockReturnValue(offline);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    await screen.findByText(fr.capture.noConnection);
    jest.mocked(captureService.send).mockClear();
    await fireEvent.press(screen.getByText(fr.capture.retry));
    await settle();

    expect(captureService.send).not.toHaveBeenCalled();
  });

  test("leaving asks first with the number of pages that will be lost, then erases them", async () => {
    const pathname = await interrupted();
    await fireEvent.press(screen.getByText(fr.common.cancel));

    expect(alert).toHaveBeenCalledWith(fr.capture.leaveTitle, fr.capture.leaveBody(2), expect.any(Array));
    expect(pathname()).toBe("/capture");
    expect(discarded()).not.toContain(ready(3));

    await confirmLeave();
    await settle();

    expect(pathname()).toBe("/");
    expect(discarded()).toEqual(expect.arrayContaining([ready(2), ready(3)]));
  });

  test("refusing to leave keeps the pages and the screen", async () => {
    const pathname = await interrupted();
    await fireEvent.press(screen.getByText(fr.common.cancel));
    await settle();

    expect(pathname()).toBe("/capture");
    expect(screen.getByText(fr.capture.retry)).toBeTruthy();
    expect(discarded()).not.toContain(ready(2));
  });
});

test("leaving while the pages are going asks first, and a confirmed leave stops after the page in flight [6]", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(3));
  const first = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValueOnce(first.promise);
  const pathname = await openCapture();
  await screen.findByText(fr.capture.sendingSeries(1, 3));
  await fireEvent.press(screen.getByText(fr.common.cancel));

  expect(alert).toHaveBeenCalledWith(fr.capture.leaveTitle, fr.capture.leaveBody(3), expect.any(Array));
  await confirmLeave();
  expect(discarded()).not.toContain(ready(1));
  expect(discarded()).toEqual(expect.arrayContaining([ready(2), ready(3)]));
  await act(async () => first.resolve({ status: "sent", pageId: "p1" }));
  await settle();

  expect(pathname()).toBe("/");
  expect(captureService.send).toHaveBeenCalledTimes(1);
  expect(discarded()).toEqual(expect.arrayContaining([ready(1), ready(2), ready(3)]));
});

test("the pages already sent are not counted among those that will be lost", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(4));
  const third = deferred<SendResult>();
  jest.mocked(captureService.send)
    .mockResolvedValueOnce({ status: "sent", pageId: "p1" })
    .mockResolvedValueOnce({ status: "sent", pageId: "p2" })
    .mockReturnValueOnce(third.promise);
  await openCapture();
  await screen.findByText(fr.capture.sendingSeries(3, 4));
  await fireEvent.press(screen.getByText(fr.common.cancel));

  expect(alert).toHaveBeenCalledWith(fr.capture.leaveTitle, fr.capture.leaveBody(2), expect.any(Array));
});

test("confirming a leave after the series ended and moved on does not go back from the page that opened", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(1));
  const only = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValueOnce(only.promise);
  const pathname = await openCapture();
  await screen.findByText(fr.capture.sendingSeries(1, 1));
  await fireEvent.press(screen.getByText(fr.common.cancel));
  await act(async () => only.resolve({ status: "sent", pageId: "p1" }));
  await settle();
  await confirmLeave();
  await settle();

  expect(pathname()).toBe("/page/p1");
});

test("leaving while the pages are going does not open anything afterwards", async () => {
  jest.mocked(scanPages).mockResolvedValue(scanned(1));
  const only = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValueOnce(only.promise);
  const pathname = await openCapture();
  await screen.findByText(fr.capture.sendingSeries(1, 1));
  await fireEvent.press(screen.getByText(fr.common.cancel));
  await confirmLeave();
  await act(async () => only.resolve({ status: "sent", pageId: "p1" }));
  await settle();

  expect(pathname()).toBe("/");
});

test("the capture texts come from the English file on an English phone", async () => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  sharpness[ready(1)] = "blurry";
  jest.mocked(scanPages).mockResolvedValue(scanned(2));
  await openApp("/");
  await screen.findByText(histoire.name);
  await loaded();
  await fireEvent.press(await screen.findByText(en.common.scan));
  await settle();

  expect(await screen.findByText(en.capture.blurryTitle(1))).toBeTruthy();
  expect(screen.getByText(en.capture.sendAnyway)).toBeTruthy();
  expect(screen.getByText(en.capture.blurryPage(1))).toBeTruthy();
});
