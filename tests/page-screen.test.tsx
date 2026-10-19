import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { StyleSheet } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { notebookService } from "@/notebooks/service";
import type { SetTypeResult, StartResult } from "@/pages/pages";
import { pageService } from "@/pages/service";
import { MAX_FORMULAS_PER_PAGE } from "@/pages/tex";
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
  pageService: { list: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn() },
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

  test("has a tall top bar, so the sheet is easy to pull by it", async () => {
    await openPage("/page/page-1/photo");
    const bar = await screen.findByTestId("photo-sheet-bar");
    expect(StyleSheet.flatten(bar.props.style).minHeight).toBeGreaterThanOrEqual(56);
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

type JsonNode = { type: string; props: Record<string, unknown>; children: (JsonNode | string)[] | null };

function textNodes(tree: unknown): JsonNode[] {
  const found: JsonNode[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== "object") {
      return;
    }
    const element = node as JsonNode;
    if (element.type === "Text") {
      found.push(element);
    }
    element.children?.forEach(visit);
  };
  visit(tree);
  return found;
}

describe("the switch of a page of math", () => {
  test("is shown off on a page of text, and turns it into a page of math [9]", async () => {
    await openPage();
    await screen.findByText(TITLE);

    const toggle = screen.getByLabelText(fr.document.mathPage);
    expect(toggle.props.value).toBe(false);
    await fireEvent(toggle, "valueChange", true);

    await waitFor(() => expect(pageService.setPageType).toHaveBeenCalledWith("page-1", "math"));
    await waitFor(() => expect(screen.getByLabelText(fr.document.mathPage).props.value).toBe(true));
  });

  test("is shown on on a page of math, and turns it back into a page of text [9]", async () => {
    pages.change("page-1", { pageType: "math" });
    await openPage();
    await screen.findByText(TITLE);

    const toggle = screen.getByLabelText(fr.document.mathPage);
    expect(toggle.props.value).toBe(true);
    await fireEvent(toggle, "valueChange", false);

    await waitFor(() => expect(pageService.setPageType).toHaveBeenCalledWith("page-1", "text"));
    await waitFor(() => expect(screen.getByLabelText(fr.document.mathPage).props.value).toBe(false));
  });

  test.each([{ status: "network" }, { status: "refused" }, { status: "error" }] as const)(
    "comes back to the type the page has when the change fails ($status), and says so",
    async (failure) => {
      jest.mocked(pageService.setPageType).mockResolvedValue(failure);
      await openPage();
      await screen.findByText(TITLE);

      await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);

      expect(await screen.findByText(fr.document.switchFailed)).toBeTruthy();
      expect(screen.getByLabelText(fr.document.mathPage).props.value).toBe(false);
      expect(pages.store[0].pageType).toBe("text");
    },
  );

  test("is not shown on a page in an unsupported script, which says it is read by the reading AI alone, under its title", async () => {
    pages.change("page-1", { pageType: "unsupported_script" });
    await openPage();
    await screen.findByText(TITLE);

    expect(screen.queryByLabelText(fr.document.mathPage)).toBeNull();
    const warning = screen.getByText(fr.document.unsupportedScript);
    const texts = textNodes(screen.toJSON());
    const title = texts.findIndex((node) => node.props.accessibilityRole === "header" && node.children?.includes(TITLE));
    const said = texts.findIndex((node) => node.children?.includes(fr.document.unsupportedScript));
    const body = texts.findIndex((node) => node.props.selectable === true && node.children?.includes("Nationalité: Portugaise"));
    expect(title).toBeGreaterThanOrEqual(0);
    expect(said).toBe(title + 1);
    expect(body).toBeGreaterThan(said);
    expect(StyleSheet.flatten(warning.props.style).color).toBe(colors.inkSecondary);
  });

  test.each(["text", "math"] as const)("is shown on a page of %s, without the warning", async (pageType) => {
    pages.change("page-1", { pageType });
    await openPage();
    await screen.findByText(TITLE);
    expect(screen.getByLabelText(fr.document.mathPage)).toBeTruthy();
    expect(screen.queryByText(fr.document.unsupportedScript)).toBeNull();
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openPage();
    await screen.findByText(TITLE);
    expect(screen.getByLabelText(en.document.mathPage)).toBeTruthy();
    expect(screen.getByText(en.document.mathPage, { includeHiddenElements: true })).toBeTruthy();
  });

  test("moves at once and waits, disabled, for the server, then comes back when the server refuses", async () => {
    const answer = deferred<SetTypeResult>();
    jest.mocked(pageService.setPageType).mockReturnValue(answer.promise);
    await openPage();
    await screen.findByText(TITLE);

    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);
    expect(screen.getByLabelText(fr.document.mathPage).props.value).toBe(true);
    await waitFor(() => expect(screen.getByLabelText(fr.document.mathPage).props.disabled).toBe(true));

    await act(async () => answer.resolve({ status: "refused" }));
    await waitFor(() => expect(screen.getByLabelText(fr.document.mathPage).props.value).toBe(false));
    expect(screen.getByLabelText(fr.document.mathPage).props.disabled).toBe(false);
    expect(screen.getByText(fr.document.switchFailed)).toBeTruthy();
  });

  test("comes back to the stored type when the call throws", async () => {
    jest.mocked(pageService.setPageType).mockRejectedValue(new Error("offline"));
    await openPage();
    await screen.findByText(TITLE);

    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);

    expect(await screen.findByText(fr.document.switchFailed)).toBeTruthy();
    expect(screen.getByLabelText(fr.document.mathPage).props.value).toBe(false);
  });

  test("names the switch once for a screen reader", async () => {
    await openPage();
    await screen.findByText(TITLE);
    expect(screen.queryByText(fr.document.mathPage)).toBeNull();
    expect(screen.getAllByLabelText(fr.document.mathPage)).toHaveLength(1);
  });

  test("shows its warning in English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    pages.change("page-1", { pageType: "unsupported_script" });
    await openPage();
    expect(await screen.findByText(en.document.unsupportedScript)).toBeTruthy();
  });
});

describe("a page of math", () => {
  const B = String.fromCharCode(92);
  const MATH_TEXT = ["Chapitre 1", "", `Soit $f(x) = ${B}frac{1}{x}$ sur $${B}mathbb{R}^*$.`, "$$", `${B}int_1^2 f(x)${B},dx = ${B}ln 2`, "$$", `Faux : $${B}frac{1}{$ et lien $${B}href{https://example.test}{x}$`].join("\n");

  test("draws its formulas, inline and on their own, and keeps the words around them in the document font [17]", async () => {
    pages.change("page-1", { pageType: "math", text: MATH_TEXT });
    await openPage();
    await screen.findByText("Chapitre 1");

    expect(await screen.findByLabelText(`$f(x) = ${B}frac{1}{x}$`)).toBeTruthy();
    expect(await screen.findByLabelText(`$${B}mathbb{R}^*$`)).toBeTruthy();
    expect(await screen.findByLabelText(`$$\n${B}int_1^2 f(x)${B},dx = ${B}ln 2\n$$`)).toBeTruthy();
    const words = screen.getByText(/^Soit /);
    expect(StyleSheet.flatten(words.props.style).fontFamily).toBe("SourceSerif4-Regular");
  });

  test("shows a formula the engine refuses as it was read, never an error, and a link command as inert text", async () => {
    pages.change("page-1", { pageType: "math", text: MATH_TEXT });
    await openPage();
    await screen.findByText("Chapitre 1");

    expect(await screen.findByText(`$${B}frac{1}{$`)).toBeTruthy();
    expect(await screen.findByText(`$${B}href{https://example.test}{x}$`)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("draws a formula that opens the page, and names the page by its number", async () => {
    pages.change("page-1", { pageType: "math", text: ["$$", "x = 2", "$$", "fin"].join(String.fromCharCode(10)) });
    await openPage();

    expect(await screen.findByLabelText(["$$", "x = 2", "$$"].join(String.fromCharCode(10)))).toBeTruthy();
    expect(screen.getByText(fr.document.pageNumber(4))).toBeTruthy();
    expect(screen.queryByText("$$")).toBeNull();
  });

  test("shows an inline formula too wide for its line as it was read", async () => {
    const wide = `$${"x + ".repeat(30)}x$`;
    pages.change("page-1", { pageType: "math", text: ["Chapitre 1", `Soit ${wide} fin`].join(String.fromCharCode(10)) });
    await openPage();
    await screen.findByText("Chapitre 1");

    expect(await screen.findByText(wide)).toBeTruthy();
    expect(screen.queryByLabelText(wide)).toBeNull();
  });

  test("draws at most a hundred formulas on a page, and shows the rest as read", async () => {
    pages.change("page-1", { pageType: "math", text: ["Chapitre 1", ...Array<string>(MAX_FORMULAS_PER_PAGE + 1).fill("Soit $y$.")].join(String.fromCharCode(10)) });
    await openPage();
    await screen.findByText("Chapitre 1");

    await waitFor(() => expect(screen.getAllByLabelText("$y$")).toHaveLength(MAX_FORMULAS_PER_PAGE));
    expect(screen.getAllByText("$y$")).toHaveLength(1);
  });

  test("keeps the LaTeX of a page of text as it was read", async () => {
    pages.change("page-1", { pageType: "text", text: MATH_TEXT });
    await openPage();
    await screen.findByText("Chapitre 1");

    expect(screen.queryByLabelText(`$f(x) = ${B}frac{1}{x}$`)).toBeNull();
    expect(screen.getByText(`Soit $f(x) = ${B}frac{1}{x}$ sur $${B}mathbb{R}^*$.`)).toBeTruthy();
  });

  test("loads nothing from the network to draw them", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const opened = jest.fn();
    const scope = globalThis as { XMLHttpRequest?: unknown };
    const original = scope.XMLHttpRequest;
    scope.XMLHttpRequest = class {
      open = opened;
      send = opened;
    };
    try {
      pages.change("page-1", { pageType: "math", text: MATH_TEXT });
      await openPage();
      await screen.findByLabelText(`$${B}mathbb{R}^*$`);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
    } finally {
      scope.XMLHttpRequest = original;
      fetchSpy.mockRestore();
    }
  });
});
