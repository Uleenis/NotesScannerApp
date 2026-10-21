import { useLocales } from "expo-localization";
import { useNetworkState } from "expo-network";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Linking } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import type { SendResult } from "@/capture/send-page";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { notebookService } from "@/notebooks/service";
import { pageService } from "@/pages/service";
import { deferred } from "./fake-auth-client";
import {
  cameraBehavior,
  cameraRendered,
  granted,
  installPermission,
  PHOTO,
  refused,
  signalCameraReady,
  takePictureAsync,
  undetermined,
} from "./fake-camera";
import { histoire, installFakeNotebooks, sciences } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
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
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));

jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(async () => []), get: jest.fn(() => new Promise(() => {})), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn() },
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

const PREPARED = "file:///cache/prepared-0.jpg";

function prepared(turns: number): string {
  return `file:///cache/prepared-${turns}.jpg`;
}

let openSettings: jest.SpyInstance;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(useNetworkState).mockReturnValue(online);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  jest.mocked(captureService.send).mockReset().mockResolvedValue({ status: "sent", pageId: "page-1" });
  jest.mocked(captureService.preparePhoto).mockReset().mockImplementation(async (_picture, turns) => prepared(turns));
  jest.mocked(captureService.discardPhoto).mockReset();
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

async function goBack(): Promise<void> {
  await act(async () => {
    router.back();
  });
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
  expect(screen.getByText(fr.limit.trialBody(3, 15))).toBeTruthy();
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
  expect(screen.queryByText(fr.limit.trialBody(3, 15))).toBeNull();
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

test("the limits are read again at the tap on scan: a limit reached since the last reading opens its sheet", async () => {
  jest.mocked(captureService.allowance).mockResolvedValueOnce(open).mockResolvedValue(monthly);
  const pathname = await openCapture();

  expect(pathname()).toBe("/limit");
  expect(screen.queryByTestId("camera-view")).toBeNull();
});

test("a limit that is gone since the last reading lets the camera open", async () => {
  jest.mocked(captureService.allowance).mockResolvedValueOnce(monthly).mockResolvedValue(open);
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
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

test("two quick taps on scan open one capture", async () => {
  const pathname = await openApp("/");
  await screen.findByText(histoire.name);
  await loaded();
  const fetching = deferred<Allowance>();
  jest.mocked(captureService.allowance).mockReturnValue(fetching.promise);
  await fireEvent.press(await screen.findByText(fr.common.scan));
  await fireEvent.press(screen.getByText(fr.common.scan));
  await act(async () => fetching.resolve(open));
  await act(async () => {});
  expect(pathname()).toBe("/capture");

  await goBack();
  expect(pathname()).toBe("/");
});

test("without a network the capture is blocked with its message and no camera [28]", async () => {
  jest.mocked(useNetworkState).mockReturnValue(offline);
  const pathname = await openCapture();

  expect(pathname()).toBe("/capture");
  expect(await screen.findByText(fr.capture.noConnection)).toBeTruthy();
  expect(screen.queryByTestId("camera-view")).toBeNull();
  expect(screen.queryByLabelText(fr.capture.shutterLabel)).toBeNull();
});

test("a network that is connected is not taken for a lost one, even if the internet is not confirmed", async () => {
  jest.mocked(useNetworkState).mockReturnValue({ isConnected: true, isInternetReachable: false });
  await openCapture();

  expect(await screen.findByTestId("camera-view")).toBeTruthy();
  expect(screen.queryByText(fr.capture.noConnection)).toBeNull();
});

test("an unknown network state does not block the camera", async () => {
  jest.mocked(useNetworkState).mockReturnValue({});
  await openCapture();

  expect(await screen.findByTestId("camera-view")).toBeTruthy();
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
});

test("while the last notebook is awaited the cancel button is there, and after a short wait the first notebook is used", async () => {
  jest.mocked(captureService.latestNotebookId).mockReturnValue(never());
  await openCapture();

  expect(screen.getByText(fr.common.cancel)).toBeTruthy();
  expect(screen.queryByTestId("camera-view")).toBeNull();

  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });

  expect(await screen.findByTestId("camera-view")).toBeTruthy();
  expect(screen.getByLabelText(fr.capture.notebookLabel)).toHaveTextContent(histoire.name, { exact: false });
});

test("a last notebook that cannot be read opens the camera in the first notebook at once", async () => {
  jest.mocked(captureService.latestNotebookId).mockRejectedValue(new Error("boom"));
  await openCapture();

  expect(await screen.findByLabelText(fr.capture.notebookLabel)).toHaveTextContent(histoire.name, { exact: false });
});

test("notebooks that cannot be read give a message with a cancel button and a retry, never a blank screen", async () => {
  jest.mocked(notebookService.list).mockRejectedValue(new Error("boom"));
  await openApp("/capture");

  expect(await screen.findByText(fr.library.loadFailed)).toBeTruthy();
  expect(screen.getByText(fr.common.cancel)).toBeTruthy();

  jest.mocked(notebookService.list).mockResolvedValue([histoire, sciences]);
  await fireEvent.press(screen.getByText(fr.common.retry));

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

test("a screen reader hears the destination notebook with its label, and the state of the flash", async () => {
  await openCapture();
  const chip = await screen.findByLabelText(fr.capture.notebookLabel);

  expect(chip.props.accessibilityValue).toEqual({ text: histoire.name });
  expect(screen.getByLabelText(fr.capture.flashLabel).props.accessibilityState).toMatchObject({ selected: false });

  await fireEvent.press(screen.getByLabelText(fr.capture.flashLabel));
  expect(screen.getByLabelText(fr.capture.flashLabel).props.accessibilityState).toMatchObject({ selected: true });
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

test("the camera keeps its focus on by itself, so handwriting is sharp", async () => {
  await openCapture();
  await screen.findByTestId("camera-view");

  expect(cameraRendered.mock.calls.at(-1)?.[0]).toMatchObject({ autofocus: "on", facing: "back" });
});

test("the shutter does nothing until the camera is ready, after a retake as well", async () => {
  cameraBehavior.readyOnMount = false;
  await openCapture();
  await screen.findByTestId("camera-view");
  await fireEvent.press(screen.getByLabelText(fr.capture.shutterLabel));
  expect(takePictureAsync).not.toHaveBeenCalled();

  await act(async () => signalCameraReady());
  await takePhoto();
  expect(takePictureAsync).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByText(fr.capture.retake));
  await screen.findByTestId("camera-view");
  await fireEvent.press(screen.getByLabelText(fr.capture.shutterLabel));
  expect(takePictureAsync).toHaveBeenCalledTimes(1);

  await act(async () => signalCameraReady());
  await fireEvent.press(screen.getByLabelText(fr.capture.shutterLabel));
  expect(takePictureAsync).toHaveBeenCalledTimes(2);
});

test("a photo that could not be taken says so and the shutter works again", async () => {
  takePictureAsync.mockRejectedValueOnce(new Error("camera busy"));
  await openCapture();
  await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));

  expect(await screen.findByText(fr.capture.shotFailed)).toBeTruthy();

  await takePhoto();
  expect(screen.queryByText(fr.capture.shotFailed)).toBeNull();
});

test("a photo is shown for checking with the page number and the notebook, and nothing is created yet", async () => {
  await openCapture();
  await takePhoto();

  expect(takePictureAsync).toHaveBeenCalledWith(expect.objectContaining({ quality: 0.9, exif: true, shutterSound: false }));
  expect(screen.getByText(fr.capture.reviewTitle(histoire.pageCount + 1, histoire.name))).toBeTruthy();
  expect(screen.getByText(fr.capture.retake)).toBeTruthy();
  expect(screen.queryByText(fr.common.cancel)).toBeNull();
  expect(captureService.send).not.toHaveBeenCalled();
});

test("the photo of the camera is turned as in the viewfinder before the check, and the turned photo is the one shown and sent", async () => {
  await openCapture();
  await takePhoto();

  expect(captureService.preparePhoto).toHaveBeenCalledWith(PHOTO, 0);
  expect(screen.getByTestId("photo-review")).toHaveProp("source", { uri: PREPARED });

  await fireEvent.press(screen.getByText(fr.capture.read));
  await waitFor(() => expect(captureService.send).toHaveBeenCalledTimes(1));
  expect(captureService.send).toHaveBeenCalledWith({ notebookId: histoire.id, photoUri: PREPARED, pageId: null }, expect.any(Function));
});

test("a photo that cannot be turned says so, deletes the photo of the camera, and the shutter works again", async () => {
  jest.mocked(captureService.preparePhoto).mockRejectedValueOnce(new Error("no memory"));
  await openCapture();
  await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));

  expect(await screen.findByText(fr.capture.shotFailed)).toBeTruthy();
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PHOTO.uri);

  await takePhoto();
  expect(screen.queryByText(fr.capture.shotFailed)).toBeNull();
});

test("rotate turns the photo a quarter turn from the photo of the camera, shows it, and deletes the one it replaces", async () => {
  await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByLabelText(fr.capture.rotateLabel));

  await waitFor(() => expect(screen.getByTestId("photo-review")).toHaveProp("source", { uri: prepared(1) }));
  expect(captureService.preparePhoto).toHaveBeenLastCalledWith(PHOTO, 1);
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PREPARED);
  expect(captureService.discardPhoto).not.toHaveBeenCalledWith(PHOTO.uri);

  await fireEvent.press(screen.getByText(fr.capture.read));
  await waitFor(() => expect(captureService.send).toHaveBeenCalledTimes(1));
  expect(captureService.send).toHaveBeenCalledWith({ notebookId: histoire.id, photoUri: prepared(1), pageId: null }, expect.any(Function));
});

test("four quarter turns come back to the photo as it was taken", async () => {
  await openCapture();
  await takePhoto();
  for (const turns of [1, 2, 3, 0]) {
    await fireEvent.press(screen.getByLabelText(fr.capture.rotateLabel));
    await waitFor(() => expect(screen.getByTestId("photo-review")).toHaveProp("source", { uri: prepared(turns) }));
  }
  expect(jest.mocked(captureService.preparePhoto).mock.calls.map((call) => call[1])).toEqual([0, 1, 2, 3, 0]);
});

test("while the photo is being turned, read the page and rotate wait, so the photo sent is the one shown", async () => {
  await openCapture();
  await takePhoto();
  const turning = deferred<string>();
  jest.mocked(captureService.preparePhoto).mockReturnValueOnce(turning.promise);
  await fireEvent.press(screen.getByLabelText(fr.capture.rotateLabel));
  await fireEvent.press(screen.getByText(fr.capture.read));
  await fireEvent.press(screen.getByLabelText(fr.capture.rotateLabel));

  expect(captureService.send).not.toHaveBeenCalled();
  expect(captureService.preparePhoto).toHaveBeenCalledTimes(2);

  await act(async () => turning.resolve(prepared(1)));
  await fireEvent.press(screen.getByText(fr.capture.read));
  await waitFor(() => expect(captureService.send).toHaveBeenCalledTimes(1));
  expect(captureService.send).toHaveBeenCalledWith({ notebookId: histoire.id, photoUri: prepared(1), pageId: null }, expect.any(Function));
});

test("a photo that cannot be turned by rotate says so and keeps the photo shown", async () => {
  await openCapture();
  await takePhoto();
  jest.mocked(captureService.preparePhoto).mockRejectedValueOnce(new Error("no memory"));
  await fireEvent.press(screen.getByLabelText(fr.capture.rotateLabel));

  expect(await screen.findByText(fr.capture.rotateFailed)).toBeTruthy();
  expect(screen.getByTestId("photo-review")).toHaveProp("source", { uri: PREPARED });
  expect(captureService.discardPhoto).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText(fr.capture.rotateLabel));
  await waitFor(() => expect(screen.getByTestId("photo-review")).toHaveProp("source", { uri: prepared(1) }));
  expect(screen.queryByText(fr.capture.rotateFailed)).toBeNull();
});

test("leaving the capture while the photo is being turned deletes every photo, the late one too", async () => {
  await openCapture();
  await takePhoto();
  const turning = deferred<string>();
  jest.mocked(captureService.preparePhoto).mockReturnValueOnce(turning.promise);
  await fireEvent.press(screen.getByLabelText(fr.capture.rotateLabel));
  await goBack();

  expect(captureService.discardPhoto).toHaveBeenCalledWith(PREPARED);
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PHOTO.uri);

  await act(async () => turning.resolve(prepared(1)));
  expect(captureService.discardPhoto).toHaveBeenCalledWith(prepared(1));
});

test("retake goes back to the camera, sends nothing and deletes the photo that was thrown away", async () => {
  await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.retake));

  expect(await screen.findByTestId("camera-view")).toBeTruthy();
  expect(captureService.send).not.toHaveBeenCalled();
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PREPARED);
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PHOTO.uri);
});

test("leaving the capture on the check of the photo deletes the photo", async () => {
  await openCapture();
  await takePhoto();
  await goBack();

  expect(captureService.discardPhoto).toHaveBeenCalledWith(PREPARED);
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PHOTO.uri);
});

test("read the page sends the photo to the chosen notebook and opens the page [1]", async () => {
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  await waitFor(() => expect(pathname()).toBe("/page/page-1"));
  expect(captureService.send).toHaveBeenCalledWith({ notebookId: histoire.id, photoUri: PREPARED, pageId: null }, expect.any(Function));
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PHOTO.uri);
  expect(captureService.discardPhoto).not.toHaveBeenCalledWith(PREPARED);
});

test("the page replaces the capture: back from the page goes to the library, not to the camera", async () => {
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));
  await waitFor(() => expect(pathname()).toBe("/page/page-1"));

  await goBack();
  expect(pathname()).toBe("/");
});

test("the page opens even when the lists of pages are slow to reload: the capture does not wait for them", async () => {
  const pathname = await openCapture();
  await takePhoto();
  jest.mocked(pageService.list).mockReturnValue(never());
  jest.mocked(captureService.allowance).mockReturnValue(never());
  await fireEvent.press(screen.getByText(fr.capture.read));

  await waitFor(() => expect(pathname()).toBe("/page/page-1"));
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
  expect(captureService.send).toHaveBeenLastCalledWith({ notebookId: histoire.id, photoUri: PREPARED, pageId: "page-7" }, expect.any(Function));
  expect(captureService.discardPhoto).not.toHaveBeenCalledWith(PREPARED);
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

test("when the network is lost on the check of the photo, the message shows at once and the sending is not tried", async () => {
  await openCapture();
  await takePhoto();
  jest.mocked(useNetworkState).mockReturnValue(offline);
  await act(async () => {
    router.setParams({ refresh: "1" });
  });

  expect(await screen.findByText(fr.capture.noConnection)).toBeTruthy();
  expect(screen.getByText(fr.capture.read)).toBeTruthy();

  await fireEvent.press(screen.getByText(fr.capture.read));
  expect(captureService.send).not.toHaveBeenCalled();
  expect(screen.getByText(fr.capture.noConnection)).toBeTruthy();

  jest.mocked(useNetworkState).mockReturnValue(online);
  await act(async () => {
    router.setParams({ refresh: "2" });
  });
  expect(screen.queryByText(fr.capture.noConnection)).toBeNull();

  await fireEvent.press(screen.getByText(fr.capture.read));
  await waitFor(() => expect(captureService.send).toHaveBeenCalledTimes(1));
});

test("a photo that is too heavy says so, in its own words", async () => {
  jest.mocked(captureService.send).mockResolvedValueOnce({ status: "tooLarge", pageId: "page-7" });
  await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  expect(await screen.findByText(fr.capture.photoTooLarge)).toBeTruthy();
  expect(screen.queryByText(fr.capture.photoUnreadable)).toBeNull();
});

test("a limit refused by the server after the photo closes the capture, opens the matching sheet and deletes the photo", async () => {
  jest.mocked(captureService.send).mockResolvedValueOnce({ status: "limit", reason: "anonymous_limit", pageId: "page-7" });
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  await waitFor(() => expect(pathname()).toBe("/limit"));
  expect(screen.getByText(fr.limit.accountTitle)).toBeTruthy();
  expect(screen.getByText(fr.limit.trialBody(3, 15))).toBeTruthy();
  expect(screen.queryByTestId("camera-view")).toBeNull();
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PREPARED);
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PHOTO.uri);

  await fireEvent.press(screen.getByText(fr.limit.later));
  expect(pathname()).toBe("/");
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

test("while a page is being sent the cancel button is there, and cancel leaves the capture", async () => {
  const sending = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValue(sending.promise);
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));

  await fireEvent.press(await screen.findByText(fr.common.cancel));
  expect(pathname()).toBe("/");
  expect(captureService.discardPhoto).not.toHaveBeenCalledWith(PREPARED);
  expect(captureService.discardPhoto).toHaveBeenCalledWith(PHOTO.uri);

  await act(async () => sending.resolve({ status: "failed", pageId: "page-1" }));
});

test("leaving the capture while a page is being sent does not bring the user to the page afterwards", async () => {
  const sending = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValue(sending.promise);
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));
  await goBack();
  expect(pathname()).toBe("/");

  await act(async () => sending.resolve({ status: "sent", pageId: "page-1" }));
  await act(async () => {});

  expect(pathname()).toBe("/");
});

test("leaving the capture while a page is being sent does not open a sheet afterwards either", async () => {
  const sending = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValue(sending.promise);
  const pathname = await openCapture();
  await takePhoto();
  await fireEvent.press(screen.getByText(fr.capture.read));
  await goBack();

  await act(async () => sending.resolve({ status: "limit", reason: "monthly_limit", pageId: "page-1" }));
  await act(async () => {});

  expect(pathname()).toBe("/");
});

test("after a page is sent the limits and the notebooks are read again, and the limits again when the reading answers", async () => {
  let readingAnswered: () => void = () => {};
  jest.mocked(captureService.send).mockImplementation(async (_input, onReadingSettled) => {
    readingAnswered = onReadingSettled ?? readingAnswered;
    return { status: "sent", pageId: "page-1" };
  });
  const pathname = await openCapture();
  await takePhoto();
  const limitsBefore = jest.mocked(captureService.allowance).mock.calls.length;
  const notebooksBefore = jest.mocked(notebookService.list).mock.calls.length;

  await fireEvent.press(screen.getByText(fr.capture.read));
  await waitFor(() => expect(pathname()).toBe("/page/page-1"));
  await waitFor(() => expect(jest.mocked(captureService.allowance).mock.calls.length).toBeGreaterThan(limitsBefore));
  await waitFor(() => expect(jest.mocked(notebookService.list).mock.calls.length).toBeGreaterThan(notebooksBefore));

  const limitsAfterSending = jest.mocked(captureService.allowance).mock.calls.length;
  await act(async () => readingAnswered());
  await waitFor(() => expect(jest.mocked(captureService.allowance).mock.calls.length).toBeGreaterThan(limitsAfterSending));
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

test("two presses in the same instant on read the page send once", async () => {
  const sending = deferred<SendResult>();
  jest.mocked(captureService.send).mockReturnValue(sending.promise);
  await openCapture();
  await takePhoto();
  const button = screen.getByText(fr.capture.read);
  const noise = jest.spyOn(console, "error").mockImplementation(() => undefined);
  await Promise.all([fireEvent.press(button), fireEvent.press(button)]);
  noise.mockRestore();

  expect(captureService.send).toHaveBeenCalledTimes(1);

  await act(async () => sending.resolve({ status: "sent", pageId: "page-1" }));
});
