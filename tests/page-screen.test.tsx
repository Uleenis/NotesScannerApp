import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { StyleSheet } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { notebookService } from "@/notebooks/service";
import type { StartResult } from "@/pages/pages";
import { pageService } from "@/pages/service";
import { deferred } from "./fake-auth-client";
import { colors } from "@/theme";
import { granted, installPermission } from "./fake-camera";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { GLUED, installFakePages, localMoment, page, photoAddress, TEXT, TITLE } from "./fake-page-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("@/pages/timing", () => require("./fake-page-service").timing);
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
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn() },
}));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn() },
}));

const fr = strings.fr;
const en = strings.en;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };
const monthly: Allowance = { ...open, used: 15, remaining: 0, blockedReason: "monthly_limit" };

const ONE_DAY = "26 septembre";

let pages: ReturnType<typeof installFakePages>;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  installFakeNotebooks([histoire]);
  installPermission(granted);
  pages = installFakePages([page()]);
});

async function openPage(initialUrl = "/page/page-1"): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return () => app.getPathname();
}

const pause = (milliseconds: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
  });

describe("the document of a page that is read", () => {
  test("shows the first non-empty line as the title, and the page and capture date above it [5]", async () => {
    await openPage();

    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText(fr.document.info(4, ONE_DAY))).toBeTruthy();
    expect(screen.getAllByText(TITLE)).toHaveLength(1);
  });

  test("shows the text without a change but its line breaks glued back, as in the mock-up", async () => {
    await openPage();
    await screen.findByText(TITLE);

    expect(screen.getByText("Nationalité: Portugaise")).toBeTruthy();
    expect(screen.getByText(GLUED)).toBeTruthy();
    expect(screen.getByText("Mort -> 27/04/1521")).toBeTruthy();
  });

  test("shows the LaTeX as it was read", async () => {
    await openPage();
    expect(await screen.findByText("$S = \\{0 ; 4\\}$")).toBeTruthy();
  });

  test("is shown at once for a page that was read before, without the waiting screen", async () => {
    await openPage();
    await screen.findByText(TITLE);

    expect(screen.queryByText(fr.reading.waitingTitle)).toBeNull();
  });

  test("names a page with no text by its number", async () => {
    pages.change("page-1", { text: null });
    await openPage();

    expect(await screen.findByText(fr.document.pageNumber(4))).toBeTruthy();
    expect(screen.getByText(fr.document.info(4, ONE_DAY))).toBeTruthy();
  });

  test("shows the name of the notebook to go back to, in the header", async () => {
    await openPage();
    await screen.findByText(TITLE);

    expect(await screen.findByText(histoire.name)).toBeTruthy();
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openPage();

    expect(await screen.findByText(en.document.info(4, "September 26"))).toBeTruthy();
  });
});

describe("the original photo", () => {
  test("opens from the thumbnail in a sheet with its title, the moment of the capture and a close button [4]", async () => {
    const pathname = await openPage();
    await screen.findByText(TITLE);

    await fireEvent.press(screen.getByLabelText(fr.document.openPhoto));
    expect(pathname()).toBe("/page/page-1/photo");
    expect(await screen.findByText(fr.photo.title)).toBeTruthy();
    expect(await screen.findByText(fr.dates.takenAt(26, 8, null, "14:32"))).toBeTruthy();
    expect(await screen.findByTestId("zoomable-photo")).toBeTruthy();
    expect(screen.getAllByText(TITLE, { includeHiddenElements: true }).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByText(fr.photo.close));
    expect(pathname()).toBe("/page/page-1");
  });

  test("outlines the thumbnail in ink while the sheet is open, and no more once it is closed", async () => {
    await openPage();
    await screen.findByText(TITLE);
    const outline = () => StyleSheet.flatten(screen.getByLabelText(fr.document.openPhoto, { includeHiddenElements: true }).props.style).borderColor;
    expect(outline()).toBe(colors.rule);

    await fireEvent.press(screen.getByLabelText(fr.document.openPhoto));
    await screen.findByTestId("zoomable-photo");
    expect(outline()).toBe(colors.ink);

    await fireEvent.press(screen.getByText(fr.photo.close));
    await waitFor(() => expect(outline()).toBe(colors.rule));
  });

  test("shows the photo the server signed for this page, and never edits it", async () => {
    await openPage();
    await screen.findByText(TITLE);
    await fireEvent.press(screen.getByLabelText(fr.document.openPhoto));
    await screen.findByTestId("zoomable-photo");

    expect(pageService.photoUrl).toHaveBeenCalledWith("test-user", "page-1");
    expect(screen.getAllByLabelText(fr.photo.label).some((image) => image.props.source?.uri === photoAddress("page-1"))).toBe(true);
  });

  test("says so when the photo cannot be loaded", async () => {
    jest.mocked(pageService.photoUrl).mockRejectedValue(new Error("denied"));
    await openPage("/page/page-1/photo");

    expect(await screen.findByText(fr.photo.loadFailed)).toBeTruthy();
  });

  test("gives the date and time in English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openPage("/page/page-1/photo");

    expect(await screen.findByText(en.dates.takenAt(26, 8, null, "14:32"))).toBeTruthy();
    expect(screen.getByText(en.photo.title)).toBeTruthy();
  });
});

describe("the waiting screen", () => {
  beforeEach(() => {
    pages = installFakePages([page({ status: "processing", text: null })]);
  });

  test("shows the page, its photo, the writing stroke and what to do [1]", async () => {
    await openPage();

    expect(await screen.findByText(fr.reading.waitingTitle)).toBeTruthy();
    expect(screen.getByText(fr.document.pageNumber(4))).toBeTruthy();
    expect(await screen.findByText(fr.reading.waitingBody(histoire.name))).toBeTruthy();
    expect(screen.getByText(fr.reading.scanNext)).toBeTruthy();
    expect(screen.getByLabelText(fr.photo.label).props.source.uri).toBe(photoAddress("page-1"));
    expect(screen.queryByText(fr.reading.relaunch)).toBeNull();
    expect(screen.queryByLabelText(fr.document.openPhoto)).toBeNull();
  });

  test("goes over to the document when the text arrives, and keeps it [1]", async () => {
    await openPage();
    await screen.findByText(fr.reading.waitingTitle);

    pages.change("page-1", { status: "read", text: TEXT });

    expect(await screen.findByText(TITLE)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(fr.reading.waitingTitle)).toBeNull());
    expect(screen.getByText(fr.document.info(4, ONE_DAY))).toBeTruthy();
  });

  test("reads the limits, the notebooks and the pages again when the page is read, since the count is made then", async () => {
    await openPage();
    await screen.findByText(fr.reading.waitingTitle);
    const limits = jest.mocked(captureService.allowance).mock.calls.length;
    const notebooks = jest.mocked(notebookService.list).mock.calls.length;
    const lists = jest.mocked(pageService.list).mock.calls.length;

    pages.change("page-1", { status: "read", text: TEXT });

    await screen.findByText(TITLE);
    await waitFor(() => {
      expect(jest.mocked(captureService.allowance).mock.calls.length).toBeGreaterThan(limits);
      expect(jest.mocked(notebookService.list).mock.calls.length).toBeGreaterThan(notebooks);
      expect(jest.mocked(pageService.list).mock.calls.length).toBeGreaterThan(lists);
    });
  });

  test("follows the status of the page by asking again while it is read", async () => {
    await openPage();
    await screen.findByText(fr.reading.waitingTitle);
    const before = jest.mocked(pageService.get).mock.calls.length;

    await waitFor(() => expect(jest.mocked(pageService.get).mock.calls.length).toBeGreaterThan(before + 1));
  });

  test("stops asking when the user leaves the screen, and the page goes on being read [3]", async () => {
    const pathname = await openPage();
    await screen.findByText(fr.reading.waitingTitle);

    await fireEvent.press(screen.getByText(fr.reading.scanNext));
    expect(pathname()).toBe("/capture");
    await pause(80);
    const asked = jest.mocked(pageService.get).mock.calls.length;
    await pause(120);

    expect(jest.mocked(pageService.get).mock.calls.length).toBe(asked);
    expect(pageService.startReading).not.toHaveBeenCalled();
  });

  test("scans the next page in the notebook of this page", async () => {
    const pathname = await openPage();
    await fireEvent.press(await screen.findByText(fr.reading.scanNext));

    await waitFor(() => expect(pathname()).toBe("/capture"));
  });

  test("shows the limit sheet instead of the camera when the limit is reached", async () => {
    jest.mocked(captureService.allowance).mockResolvedValue(monthly);
    const pathname = await openPage();
    await fireEvent.press(await screen.findByText(fr.reading.scanNext));

    await waitFor(() => expect(pathname()).toBe("/limit"));
  });

  test("does not start a reading that the capture already started", async () => {
    await openPage();
    await screen.findByText(fr.reading.waitingTitle);
    await pause(150);

    expect(pageService.startReading).not.toHaveBeenCalled();
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openPage();

    expect(await screen.findByText(en.reading.waitingTitle)).toBeTruthy();
    expect(await screen.findByText(en.reading.waitingBody(histoire.name))).toBeTruthy();
    expect(screen.getByText(en.reading.scanNext)).toBeTruthy();
  });
});

describe("a page that is queued with no cause", () => {
  const stuck = (secondsAgo: number) => page({ status: "queued", text: null, uploadedAt: localMoment(8, 26, 14, 32, secondsAgo) });

  test("is started by the screen when the capture had its time and nothing started it, once", async () => {
    pages = installFakePages([stuck(600)]);
    await openPage();

    await waitFor(() => expect(pageService.startReading).toHaveBeenCalledTimes(1));
    expect(pageService.startReading).toHaveBeenCalledWith("page-1");
    await pause(150);
    expect(pageService.startReading).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(fr.reading.waitingTitle)).toBeTruthy();
  });

  test("is left alone for the first seconds, which belong to the capture", async () => {
    pages = installFakePages([page({ status: "queued", text: null, uploadedAt: new Date().toISOString() })]);
    await openPage();
    await screen.findByText(fr.reading.waitingTitle);

    expect(pageService.startReading).not.toHaveBeenCalled();
    await waitFor(() => expect(pageService.startReading).toHaveBeenCalledTimes(1));
  });

  test("is not started by a screen the user left, whose data went stale while the server put the page off", async () => {
    pages = installFakePages([page({ status: "queued", text: null, uploadedAt: new Date().toISOString() })]);
    const pathname = await openPage();
    await screen.findByText(fr.reading.waitingTitle);
    await fireEvent.press(screen.getByText(fr.reading.scanNext));
    await waitFor(() => expect(pathname()).toBe("/capture"));

    pages.change("page-1", { queueReason: "read_error", attemptedAt: new Date().toISOString() });
    await pause(300);

    expect(pageService.startReading).not.toHaveBeenCalled();
  });

  test("is not started when the page is already being read", async () => {
    pages = installFakePages([page({ status: "processing", text: null, uploadedAt: localMoment(8, 26, 14, 32, 600) })]);
    await openPage();
    await screen.findByText(fr.reading.waitingTitle);
    await pause(150);

    expect(pageService.startReading).not.toHaveBeenCalled();
  });

  test("opens the limit sheet when the server refuses for the limit, and keeps the page on hold", async () => {
    pages = installFakePages([stuck(600)]);
    jest.mocked(pageService.startReading).mockResolvedValue({ status: "limit", reason: "monthly_limit" });
    jest.mocked(captureService.allowance).mockResolvedValue(monthly);
    const pathname = await openPage();

    await waitFor(() => expect(pathname()).toBe("/limit"));
    expect(await screen.findByText(fr.limit.monthTitle(15))).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.limit.understood));
    expect(pathname()).toBe("/page/page-1");
    expect(await screen.findByText(fr.reading.heldTitle)).toBeTruthy();
    expect(screen.getByText(fr.reading.heldBody)).toBeTruthy();
  });

  test.each([
    ["the trial", "anonymous_limit", fr.limit.accountTitle],
    ["the daily cap", "anonymous_daily_cap", fr.limit.accountTitle],
  ] as const)("opens the account sheet when %s is reached", async (_, reason, title) => {
    pages = installFakePages([stuck(600)]);
    jest.mocked(pageService.startReading).mockResolvedValue({ status: "limit", reason });
    jest.mocked(captureService.allowance).mockResolvedValue({ ...open, isAnonymous: true, blockedReason: reason });
    const pathname = await openPage();

    await waitFor(() => expect(pathname()).toBe("/limit"));
    expect(await screen.findByText(title)).toBeTruthy();
  });

  test("says that the photo cannot be read when the server refuses it", async () => {
    pages = installFakePages([stuck(600)]);
    jest.mocked(pageService.startReading).mockResolvedValue({ status: "photo" });
    await openPage();

    expect(await screen.findByText(fr.reading.unreadableTitle)).toBeTruthy();
    expect(screen.getByText(fr.reading.unreadableBody)).toBeTruthy();
    expect(screen.getByText(fr.reading.backTo(histoire.name))).toBeTruthy();
    expect(screen.getByText(fr.reading.scanNext)).toBeTruthy();
  });

  test("keeps waiting and shows nothing alarming when the call did not reach the server", async () => {
    pages = installFakePages([stuck(600)]);
    jest.mocked(pageService.startReading).mockResolvedValue({ status: "network" });
    await openPage();

    await waitFor(() => expect(pageService.startReading).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(fr.reading.waitingTitle)).toBeTruthy();
    expect(screen.queryByText(fr.reading.relaunchFailed)).toBeNull();
  });
});

describe("a reading that was put off", () => {
  beforeEach(() => {
    pages = installFakePages([page({ status: "queued", queueReason: "read_error", attemptedAt: localMoment(9, 6, 12, 0, 300), text: null })]);
  });

  test("says why, when the next try is, and that the photo is saved, with the two ways out", async () => {
    await openPage();

    expect(await screen.findByText(fr.reading.deferredTitle)).toBeTruthy();
    expect(screen.getByText(/dans \d+ minutes?\./)).toBeTruthy();
    expect(screen.getByText(fr.reading.backTo(histoire.name))).toBeTruthy();
    expect(screen.getByText(fr.reading.scanNext)).toBeTruthy();
    expect(screen.queryByText(fr.reading.waitingTitle)).toBeNull();
    expect(screen.queryByText(fr.reading.relaunch)).toBeNull();
  });

  test("never asks the server to read again by itself: the schedule does it", async () => {
    await openPage();
    await screen.findByText(fr.reading.deferredTitle);
    await pause(150);

    expect(pageService.startReading).not.toHaveBeenCalled();
  });

  test("goes back to the notebook", async () => {
    const pathname = await openPage();
    await fireEvent.press(await screen.findByText(fr.reading.backTo(histoire.name)));

    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
  });

  test("shows the document when the schedule has read the page in the meantime", async () => {
    await openPage();
    await screen.findByText(fr.reading.deferredTitle);

    pages.change("page-1", { status: "read", queueReason: null, text: TEXT });

    expect(await screen.findByText(TITLE)).toBeTruthy();
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openPage();

    expect(await screen.findByText(en.reading.deferredTitle)).toBeTruthy();
    expect(screen.getByText(en.reading.backTo(histoire.name))).toBeTruthy();
  });
});

describe("a reading that failed", () => {
  beforeEach(() => {
    pages = installFakePages([page({ status: "failed", text: null })]);
  });

  test("says it failed and that the photo stays, and offers to read again [25]", async () => {
    await openPage();

    expect(await screen.findByText(fr.reading.failedTitle)).toBeTruthy();
    expect(screen.getByText(fr.reading.failedBody)).toBeTruthy();
    expect(screen.getByText(fr.reading.relaunch)).toBeTruthy();
    expect(screen.getByText(fr.reading.backTo(histoire.name))).toBeTruthy();
    expect(screen.queryByText(fr.reading.scanNext)).toBeNull();
    expect(pageService.startReading).not.toHaveBeenCalled();
  });

  test("reads again on request, shows the waiting screen while it does, then the document [25]", async () => {
    const answer = deferred<StartResult>();
    jest.mocked(pageService.startReading).mockReturnValue(answer.promise);
    await openPage();

    await fireEvent.press(await screen.findByText(fr.reading.relaunch));
    expect(pageService.startReading).toHaveBeenCalledWith("page-1");
    expect(await screen.findByText(fr.reading.waitingTitle)).toBeTruthy();
    expect(screen.queryByText(fr.reading.failedTitle)).toBeNull();
    expect(screen.queryByText(fr.reading.relaunch)).toBeNull();

    pages.change("page-1", { status: "read", text: TEXT });
    await act(async () => {
      answer.resolve({ status: "read" });
    });

    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(pageService.startReading).toHaveBeenCalledTimes(1);
  });

  test("shows the failure again, with no new message, when the new try failed too", async () => {
    jest.mocked(pageService.startReading).mockResolvedValue({ status: "failed" });
    await openPage();

    await fireEvent.press(await screen.findByText(fr.reading.relaunch));

    expect(await screen.findByText(fr.reading.failedTitle)).toBeTruthy();
    expect(screen.queryByText(fr.reading.relaunchFailed)).toBeNull();
    expect(screen.queryByText(fr.reading.relaunchTooSoon)).toBeNull();
  });

  test("says that the page was already read again today when the server refuses for it", async () => {
    jest.mocked(pageService.startReading).mockResolvedValue({ status: "tooSoon" });
    await openPage();

    await fireEvent.press(await screen.findByText(fr.reading.relaunch));

    expect(await screen.findByText(fr.reading.relaunchTooSoon)).toBeTruthy();
    expect(screen.getByText(fr.reading.failedTitle)).toBeTruthy();
    expect(screen.getByText(fr.reading.relaunch)).toBeTruthy();
  });

  test.each(["network", "error"] as const)("says the new try did not go through after %s, and lets the user try again", async (status) => {
    jest.mocked(pageService.startReading).mockResolvedValue({ status });
    await openPage();

    await fireEvent.press(await screen.findByText(fr.reading.relaunch));

    expect(await screen.findByText(fr.reading.relaunchFailed)).toBeTruthy();
    expect(screen.getByText(fr.reading.relaunch)).toBeTruthy();
  });

  test("clears the message of the last try when the user tries again", async () => {
    jest.mocked(pageService.startReading).mockResolvedValueOnce({ status: "tooSoon" }).mockResolvedValue({ status: "failed" });
    await openPage();
    await fireEvent.press(await screen.findByText(fr.reading.relaunch));
    await screen.findByText(fr.reading.relaunchTooSoon);

    await fireEvent.press(screen.getByText(fr.reading.relaunch));
    await pause(50);

    expect(pageService.startReading).toHaveBeenCalledTimes(2);
    expect(screen.getByText(fr.reading.failedTitle)).toBeTruthy();
    expect(screen.queryByText(fr.reading.relaunchTooSoon)).toBeNull();
  });

  test("opens the limit sheet when the server refuses for the limit", async () => {
    jest.mocked(pageService.startReading).mockResolvedValue({ status: "limit", reason: "monthly_limit" });
    jest.mocked(captureService.allowance).mockResolvedValue(monthly);
    const pathname = await openPage();

    await fireEvent.press(await screen.findByText(fr.reading.relaunch));

    await waitFor(() => expect(pathname()).toBe("/limit"));
  });

  test("does not open the limit sheet over another screen when the user left while the server was answering", async () => {
    const answer = deferred<StartResult>();
    jest.mocked(pageService.startReading).mockReturnValue(answer.promise);
    const pathname = await openPage();
    await fireEvent.press(await screen.findByText(fr.reading.relaunch));
    await fireEvent.press(await screen.findByText(fr.reading.scanNext));
    await waitFor(() => expect(pathname()).toBe("/capture"));

    await act(async () => {
      answer.resolve({ status: "limit", reason: "monthly_limit" });
    });
    await pause(50);

    expect(pathname()).toBe("/capture");
  });

  test("says that the photo cannot be read when the server refuses it", async () => {
    jest.mocked(pageService.startReading).mockResolvedValue({ status: "photo" });
    await openPage();

    await fireEvent.press(await screen.findByText(fr.reading.relaunch));

    expect(await screen.findByText(fr.reading.unreadableTitle)).toBeTruthy();
  });

  test("goes back to the notebook", async () => {
    const pathname = await openPage();
    await fireEvent.press(await screen.findByText(fr.reading.backTo(histoire.name)));

    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openPage();

    expect(await screen.findByText(en.reading.failedTitle)).toBeTruthy();
    expect(screen.getByText(en.reading.relaunch)).toBeTruthy();
  });
});

describe("a page that is not there", () => {
  test("goes back to the library for a page that does not exist or is not visible", async () => {
    pages = installFakePages([]);
    const pathname = await openPage("/page/ghost");

    await waitFor(() => expect(pathname()).toBe("/"));
  });

  test("says so when the page cannot be loaded, and loads it again on request", async () => {
    jest.mocked(pageService.get).mockRejectedValueOnce(new Error("offline"));
    await openPage();

    expect(await screen.findByText(fr.reading.loadFailed)).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.common.retry));

    expect(await screen.findByText(TITLE)).toBeTruthy();
  });
});
