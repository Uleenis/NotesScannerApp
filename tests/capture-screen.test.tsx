import { useLocales } from "expo-localization";
import { useNetworkState } from "expo-network";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Linking } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import type { SendResult } from "@/capture/send-page";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { deferred } from "./fake-auth-client";
import { granted, installPermission, PHOTO, refused, takePictureAsync, undetermined } from "./fake-camera";
import { histoire, installFakeNotebooks, sciences } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("expo-network", () => ({ useNetworkState: jest.fn() }));
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: {
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
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn() },
}));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn() },
}));

const fr = strings.fr;
const en = strings.en;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };
const monthly: Allowance = { ...open, used: 15, remaining: 0, blockedReason: "monthly_limit" };
const trial: Allowance = { isAnonymous: true, used: 3, max: 3, remaining: 0, resetsAt: null, blockedReason: "anonymous_limit" };
const daily: Allowance = { isAnonymous: true, used: 0, max: 3, remaining: 3, resetsAt: null, blockedReason: "anonymous_daily_cap" };

const online = { isConnected: true, isInternetReachable: true };

let openSettings: jest.SpyInstance;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(useNetworkState).mockReturnValue(online);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user" });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  jest.mocked(captureService.send).mockReset().mockResolvedValue({ status: "sent", pageId: "page-1" });
  installFakeNotebooks([histoire, sciences]);
  installPermission(granted);
  openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
});

afterEach(() => {
  openSettings.mockRestore();
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

async function pressScan(): Promise<void> {
  await fireEvent.press(await screen.findByText(fr.common.scan));
  await act(async () => {});
}

async function openCapture(): Promise<() => string> {
  const pathname = await openApp("/");
  await screen.findByText(histoire.name);
  await loaded();
  await pressScan();
  return pathname;
}

async function takePhoto(): Promise<void> {
  await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));
  await screen.findByText(fr.capture.read);
}

test("scan opens the camera when nothing blocks, in the notebook of the last page", async () => {
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
  expect(await screen.findByTestId("camera-view")).toBeTruthy();
  expect(screen.getByText(fr.capture.hint)).toBeTruthy();
  expect(screen.getByLabelText(fr.capture.notebookLabel)).toHaveTextContent(histoire.name, { exact: false });
});

test("scan opens the camera when the limits could not be read: the server stays the authority", async () => {
  jest.mocked(captureService.allowance).mockRejectedValue(new Error("offline"));
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
  expect(await screen.findByTestId("camera-view")).toBeTruthy();
});

test("the monthly limit opens its sheet before the camera, with the date of the reset [22]", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue(monthly);
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
  expect(screen.getByText(fr.limit.monthTitle(15))).toBeTruthy();
  expect(screen.getByText(fr.limit.monthBody(10))).toBeTruthy();
  expect(screen.getByText(fr.limit.monthBody(10))).toHaveTextContent("1er novembre", { exact: false });
  expect(screen.getByText(fr.limit.understood)).toBeTruthy();
  expect(screen.queryByText(fr.limit.createAccount)).toBeNull();
  expect(screen.queryByTestId("camera-view")).toBeNull();

  await fireEvent.press(screen.getByText(fr.limit.understood));
  expect(pathname()).toBe("/");
});

test("the three trial pages read open the account sheet before the camera [22]", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue(trial);
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
  expect(screen.getByText(fr.limit.accountTitle)).toBeTruthy();
  expect(screen.getByText(fr.limit.trialBody)).toBeTruthy();
  expect(screen.getByText(fr.limit.createAccount)).toBeTruthy();
  expect(screen.getByText(fr.limit.later)).toBeTruthy();
  expect(screen.queryByTestId("camera-view")).toBeNull();

  await fireEvent.press(screen.getByText(fr.limit.later));
  expect(pathname()).toBe("/");
});

test("the daily cap of the anonymous accounts opens the account sheet with its own sentence [22]", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue(daily);
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
  expect(screen.getByText(fr.limit.accountTitle)).toBeTruthy();
  expect(screen.getByText(fr.limit.dailyBody)).toBeTruthy();
  expect(screen.queryByText(fr.limit.trialBody)).toBeNull();
  expect(screen.queryByTestId("camera-view")).toBeNull();
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
  const app = renderRouter("./src/app", { initialUrl: "/" });
  await app;
  await screen.findByText(en.common.scan);
  await loaded();
  await fireEvent.press(screen.getByText(en.common.scan));
  await act(async () => {});

  expect(screen.getByText(en.limit.monthTitle(15))).toBeTruthy();
  expect(screen.getByText(en.limit.monthBody(10))).toHaveTextContent("November 1", { exact: false });
});

test("without a network the capture is blocked with its message and no camera [28]", async () => {
  jest.mocked(useNetworkState).mockReturnValue({ isConnected: false, isInternetReachable: false });
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
  expect(await screen.findByText(fr.capture.noConnection)).toBeTruthy();
  expect(screen.queryByTestId("camera-view")).toBeNull();
  expect(screen.queryByLabelText(fr.capture.shutterLabel)).toBeNull();
});

test("a network that is connected but cannot reach the internet blocks the capture too [28]", async () => {
  jest.mocked(useNetworkState).mockReturnValue({ isConnected: true, isInternetReachable: false });
  await openCapture();

  expect(await screen.findByText(fr.capture.noConnection)).toBeTruthy();
  expect(screen.queryByTestId("camera-view")).toBeNull();
});

test("an unknown network state does not block the camera", async () => {
  jest.mocked(useNetworkState).mockReturnValue({});
  await openCapture();

  expect(await screen.findByTestId("camera-view")).toBeTruthy();
});

test("cancel closes the capture", async () => {
  const pathname = await openCapture();
  await fireEvent.press(await screen.findByText(fr.common.cancel));

  expect(pathname()).toBe("/");
});

test("a refused camera shows its message and a button that opens the settings [28]", async () => {
  installPermission(refused);
  await openCapture();

  expect(await screen.findByText(fr.capture.cameraNeeded)).toBeTruthy();
  expect(screen.queryByTestId("camera-view")).toBeNull();

  await fireEvent.press(screen.getByText(fr.capture.openSettings));
  expect(openSettings).toHaveBeenCalledTimes(1);
});

test("the camera permission is asked when it was never asked", async () => {
  const { request } = installPermission(undetermined);
  await openCapture();

  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
});

test("a counter shows at three pages left, in pages of the month for an account", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue({ ...open, remaining: 3 });
  await openCapture();

  expect(await screen.findByText(fr.capture.counterMonth(3))).toBeTruthy();
});

test("no counter above three pages left", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue({ ...open, remaining: 4 });
  await openCapture();
  await screen.findByTestId("camera-view");

  expect(screen.queryByText(fr.capture.counterMonth(4))).toBeNull();
  expect(screen.queryByText(/Plus que/)).toBeNull();
});

test("an anonymous account counts its trial pages", async () => {
  jest.mocked(captureService.allowance).mockResolvedValue({ ...open, isAnonymous: true, max: 3, remaining: 2, resetsAt: null });
  await openCapture();

  expect(await screen.findByText(fr.capture.counterTrial(2))).toBeTruthy();
});

test("the notebook of the capture can be changed with a tap", async () => {
  await openCapture();
  await fireEvent.press(await screen.findByLabelText(fr.capture.notebookLabel));
  await fireEvent.press(await screen.findByText(sciences.name));

  expect(screen.getByLabelText(fr.capture.notebookLabel)).toHaveTextContent(sciences.name, { exact: false });
});

test("scan from a notebook opens the capture in that notebook", async () => {
  jest.mocked(captureService.latestNotebookId).mockResolvedValue(histoire.id);
  await openApp(`/notebook/${sciences.id}`);
  await screen.findByText(fr.notebook.emptyTitle);
  await loaded();
  await pressScan();

  expect(await screen.findByLabelText(fr.capture.notebookLabel)).toHaveTextContent(sciences.name, { exact: false });
});

test("the first notebook is used when no page was ever taken", async () => {
  jest.mocked(captureService.latestNotebookId).mockResolvedValue(null);
  await openCapture();

  expect(await screen.findByLabelText(fr.capture.notebookLabel)).toHaveTextContent(histoire.name, { exact: false });
});

test("the flash can be switched on", async () => {
  await openCapture();
  expect((await screen.findByTestId("camera-view")).props.accessibilityState).toEqual({ selected: false });
  await fireEvent.press(screen.getByLabelText(fr.capture.flashLabel));

  expect(screen.getByTestId("camera-view").props.accessibilityState).toEqual({ selected: true });
});

test("a photo is shown for checking with the page number and the notebook, and nothing is created yet", async () => {
  await openCapture();
  await takePhoto();

  expect(takePictureAsync).toHaveBeenCalledWith(expect.objectContaining({ quality: 0.9, exif: false }));
  expect(screen.getByText(fr.capture.reviewTitle(histoire.pageCount + 1, histoire.name))).toBeTruthy();
  expect(screen.getByText(fr.capture.retake)).toBeTruthy();
  expect(captureService.send).not.toHaveBeenCalled();
});

test("retake goes back to the camera and sends nothing", async () => {
  await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.retake));

  expect(await screen.findByTestId("camera-view")).toBeTruthy();
  expect(captureService.send).not.toHaveBeenCalled();
});

test("read the page sends the photo to the chosen notebook and opens the page [1]", async () => {
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  await waitFor(() => expect(pathname()).toBe("/page/page-1"));
  expect(captureService.send).toHaveBeenCalledWith({ notebookId: histoire.id, photoUri: PHOTO.uri, pageId: null });
});

test("a failed sending keeps the photo, says so, and the next try reuses the same page", async () => {
  jest.mocked(captureService.send).mockResolvedValueOnce({ status: "failed", pageId: "page-7" });
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  expect(await screen.findByText(fr.capture.sendFailed)).toBeTruthy();
  expect(pathname()).toBe("/capture");

  await fireEvent.press(screen.getByText(fr.capture.read));
  await waitFor(() => expect(captureService.send).toHaveBeenCalledTimes(2));
  expect(captureService.send).toHaveBeenLastCalledWith({ notebookId: histoire.id, photoUri: PHOTO.uri, pageId: "page-7" });
  await waitFor(() => expect(pathname()).toBe("/page/page-1"));
});

test("a sending that loses the network says there is no connection and keeps the photo", async () => {
  jest.mocked(captureService.send).mockResolvedValueOnce({ status: "network", pageId: null });
  await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  expect(await screen.findByText(fr.capture.noConnection)).toBeTruthy();
  expect(screen.getByText(fr.capture.read)).toBeTruthy();
});

test("a photo the server cannot read asks to retake it", async () => {
  jest.mocked(captureService.send).mockResolvedValueOnce({ status: "photo", pageId: "page-7" });
  await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  expect(await screen.findByText(fr.capture.photoUnreadable)).toBeTruthy();
});

test("a limit refused by the server after the photo opens the matching sheet", async () => {
  jest.mocked(captureService.send).mockResolvedValueOnce({ status: "limit", reason: "anonymous_limit", pageId: "page-7" });
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  await waitFor(() => expect(pathname()).toBe("/limit"));
  expect(screen.getByText(fr.limit.accountTitle)).toBeTruthy();
  expect(screen.getByText(fr.limit.trialBody)).toBeTruthy();
});

test("two quick presses on read the page send once, and the button says it is sending", async () => {
  const sending = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValue(sending.promise);
  await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));
  await fireEvent.press(screen.getByText(fr.capture.sending));

  expect(captureService.send).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(fr.capture.read)).toBeNull();

  await act(async () => sending.resolve({ status: "sent", pageId: "page-1" }));
});

test("the capture texts come from the English file on an English phone", async () => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  const app = renderRouter("./src/app", { initialUrl: "/" });
  await app;
  await screen.findByText(en.common.scan);
  await loaded();
  await fireEvent.press(screen.getByText(en.common.scan));
  await act(async () => {});

  expect(await screen.findByText(en.capture.hint)).toBeTruthy();
});
