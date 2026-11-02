import { useLocales } from "expo-localization";
import { useNetworkState } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { ActionSheetIOS, Alert } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { closeMenu } from "@/lib/action-menu";
import { notebookService } from "@/notebooks/service";
import { setOnline } from "@/offline/network";
import { pageService } from "@/pages/service";
import { renderingFingerprint, type StoredRendering } from "@/render/api";
import { resetRenderMode } from "@/render/mode";
import { renderService } from "@/render/service";
import { resetRenderAttempts } from "@/render/use-rendering";
import { installFakeLibrary } from "./fake-library";
import { installFakeWords, localMoment, page, regexWordsOf } from "./fake-page-service";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock("expo-network", () => ({ useNetworkState: jest.fn() }));
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
jest.mock("@/notebooks/service", () => ({ notebookService: require("./library-mocks").NOTEBOOK_SERVICE_MOCK }));
jest.mock("@/pages/service", () => ({ pageService: require("./library-mocks").PAGE_SERVICE_MOCK }));
jest.mock("@/render/service", () => ({ renderService: { read: jest.fn(), render: jest.fn() } }));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn(), prepareScan: jest.fn(), discardPhoto: jest.fn(), checkSharpness: jest.fn() },
}));

const fr = strings.fr;
const en = strings.en;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };

const histoire = { id: "hist", name: "Histoire" };
const moyenAge = { id: "ch-moyen", notebookId: "hist", name: "Moyen Âge" };
const RAW = "Les suites\nUne suite converge si elle est bornée.";
const RENDERED = "# Les suites\n\nUne suite converge si elle est **bornée**.";

const read = jest.mocked(renderService.read);
const render = jest.mocked(renderService.render);
const sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions");
const alert = jest.spyOn(Alert, "alert");

let stored: StoredRendering | null;
let library: ReturnType<typeof installFakeLibrary>;

function goOffline(): void {
  jest.mocked(useNetworkState).mockReturnValue({ isConnected: false, isInternetReachable: false });
}

function install(extra: Partial<Parameters<typeof page>[0]> = {}) {
  const lesSuites = page({ id: "page-1", notebookId: histoire.id, chapterId: moyenAge.id, text: RAW, capturedAt: localMoment(8, 26, 14, 32), ...extra });
  library = installFakeLibrary({ notebooks: [histoire], chapters: [moyenAge], pages: [lesSuites] });
  return lesSuites;
}

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(useNetworkState).mockReturnValue({ isConnected: true, isInternetReachable: true });
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: false });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  jest.mocked(SecureStore.getItemAsync).mockReset().mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockReset().mockResolvedValue(undefined);
  sheet.mockReset().mockImplementation(() => undefined);
  alert.mockReset().mockImplementation(() => undefined);
  stored = null;
  resetRenderMode();
  resetRenderAttempts();
  read.mockReset().mockImplementation(async () => stored);
  render.mockReset().mockResolvedValue({ status: "ready", text: RENDERED });
  setOnline(true);
  install();
});

afterEach(async () => {
  await act(async () => closeMenu());
  setOnline(true);
});

async function openApp(initialUrl: string): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return () => app.getPathname();
}

async function chooseFromMenu(menuLabel: string, item: string): Promise<void> {
  await fireEvent.press(await screen.findByLabelText(menuLabel));
  const option = (await screen.findAllByTestId(/^action-sheet-option-/)).find((node) => node.props.accessibilityLabel === item);
  expect(option).toBeDefined();
  await fireEvent.press(option!);
}

function expectRefused(): void {
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith(fr.offline.needsNetwork);
}

describe("the line at the top of the library [6]", () => {
  test("says the phone is offline, and says nothing when the network is there", async () => {
    await openApp("/");
    await screen.findByText(histoire.name);
    expect(screen.queryByText(fr.offline.banner)).toBeNull();
    await act(async () => setOnline(false));
    expect(screen.getByText(fr.offline.banner)).toBeTruthy();
    await act(async () => setOnline(true));
    expect(screen.queryByText(fr.offline.banner)).toBeNull();
  });

  test("follows the network state of the phone and speaks the language of the phone [14]", async () => {
    goOffline();
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openApp("/");
    expect(await screen.findByText(histoire.name)).toBeTruthy();
    expect(screen.getByText(en.offline.banner)).toBeTruthy();
  });
});

describe("the gestures of the library without network [7]", () => {
  test("search, new notebook and the account show the sentence and open nothing", async () => {
    goOffline();
    const pathname = await openApp("/");
    await screen.findByText(histoire.name);

    await fireEvent.press(screen.getByText(fr.search.open));
    await fireEvent.press(screen.getByText(fr.library.newNotebook));
    await fireEvent.press(screen.getByLabelText(fr.account.title));

    expect(alert.mock.calls).toEqual([[fr.offline.needsNetwork], [fr.offline.needsNetwork], [fr.offline.needsNetwork]]);
    expect(pathname()).toBe("/");
  });

  test("works as before with the network", async () => {
    const pathname = await openApp("/");
    await fireEvent.press(await screen.findByText(fr.search.open));
    await waitFor(() => expect(pathname()).toBe("/search"));
    expect(alert).not.toHaveBeenCalled();
  });
});

describe("the gestures of a notebook and of a chapter without network [7]", () => {
  test.each([
    [fr.search.open],
    [fr.export.label],
    [fr.notebook.newChapter],
    [fr.notebook.rename],
    [fr.notebook.level.label],
    [fr.notebook.delete],
  ])("the notebook menu item %s shows the sentence and changes nothing", async (item) => {
    goOffline();
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);

    await chooseFromMenu(fr.notebook.menuLabel, item);

    expectRefused();
    expect(pathname()).toBe(`/notebook/${histoire.id}`);
    expect(notebookService.remove).not.toHaveBeenCalled();
  });

  test.each([[fr.export.label], [fr.chapter.rename], [fr.chapter.delete]])("the chapter menu item %s shows the sentence and changes nothing", async (item) => {
    goOffline();
    const pathname = await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText(RAW.split("\n")[0]);

    await chooseFromMenu(fr.chapter.menuLabel, item);

    expectRefused();
    expect(pathname()).toBe(`/chapter/${moyenAge.id}`);
    expect(notebookService.removeChapter).not.toHaveBeenCalled();
  });
});

describe("the gestures of a page without network [7]", () => {
  test.each([[fr.export.label], [fr.pageMenu.move], [fr.pageMenu.delete]])("the page menu item %s shows the sentence and changes nothing", async (item) => {
    goOffline();
    const pathname = await openApp("/page/page-1");
    await screen.findByText("Les suites");

    await chooseFromMenu(fr.pageMenu.label, item);

    expectRefused();
    expect(pathname()).toBe("/page/page-1");
    expect(pageService.remove).not.toHaveBeenCalled();
    expect(pageService.move).not.toHaveBeenCalled();
  });

  test("a tap on the text, the edit button and the math switch show the sentence and call nothing", async () => {
    goOffline();
    await openApp("/page/page-1");
    const title = await screen.findByText("Les suites");

    await fireEvent.press(title);
    await fireEvent.press(await screen.findByText(fr.document.edit));
    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);

    expect(alert.mock.calls).toEqual([[fr.offline.needsNetwork], [fr.offline.needsNetwork], [fr.offline.needsNetwork]]);
    expect(pageService.setPageType).not.toHaveBeenCalled();
    expect(pageService.correct).not.toHaveBeenCalled();
    expect(pageService.edit).not.toHaveBeenCalled();
    expect(screen.queryByText(fr.document.switchLosesTitle)).toBeNull();
  });

  test("does not ask the server for the words or for the second reading", async () => {
    goOffline();
    await openApp("/page/page-1");
    await screen.findByText("Les suites");
    expect(pageService.words).not.toHaveBeenCalled();
    expect(pageService.second).not.toHaveBeenCalled();
  });

  test("lets the edit button and the taps work with the network", async () => {
    installFakeWords(library.pages, "page-1", RAW, regexWordsOf(RAW));
    await openApp("/page/page-1");
    await screen.findByText("Les suites");
    await fireEvent.press(await screen.findByText(fr.document.edit));
    expect(alert).not.toHaveBeenCalled();
  });

  test("does not ask for a reading of a page that waits", async () => {
    goOffline();
    install({ text: null, status: "queued", queueReason: "read_error", attemptedAt: null, uploadedAt: localMoment(8, 26, 14, 20) });
    await openApp("/page/page-1");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(pageService.startReading).not.toHaveBeenCalled();
  });
});

describe("the reading of a page that failed, without network [7]", () => {
  test("the button to read again shows the sentence and calls nothing", async () => {
    goOffline();
    install({ text: null, status: "failed", queueReason: "read_error", attemptedAt: localMoment(8, 26, 14, 40), uploadedAt: localMoment(8, 26, 14, 20) });
    await openApp("/page/page-1");
    await fireEvent.press(await screen.findByText(fr.reading.relaunch));
    expectRefused();
    expect(pageService.startReading).not.toHaveBeenCalled();
  });
});

describe("the photo of a page without network [6]", () => {
  test("opens the photo kept on the phone and erases the clear file when the page is left", async () => {
    goOffline();
    const release = jest.fn();
    jest.mocked(pageService.localPhoto).mockResolvedValue({ uri: "file:///cache/offline-view/a.jpg", release });
    const app = renderRouter("./src/app", { initialUrl: "/page/page-1" });
    await app;
    await screen.findByText("Les suites");
    await waitFor(() => expect(pageService.localPhoto).toHaveBeenCalledWith("page-1"));
    expect(pageService.photoUrl).not.toHaveBeenCalled();
    await waitFor(() => expect(JSON.stringify(screen.toJSON())).toContain("file:///cache/offline-view/a.jpg"));
    expect(release).not.toHaveBeenCalled();
    await act(async () => screen.unmount());
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("says the photo comes with a connection when it is not kept", async () => {
    goOffline();
    jest.mocked(pageService.localPhoto).mockRejectedValue(new Error("photo_unavailable"));
    await openApp("/page/page-1/photo");
    expect(await screen.findByText(fr.photo.offlineMissing)).toBeTruthy();
    expect(screen.queryByText(fr.photo.loadFailed)).toBeNull();
  });

  test("keeps the sentence for a real failure of the photo with the network", async () => {
    jest.mocked(pageService.photoUrl).mockRejectedValue(new Error("down"));
    jest.mocked(pageService.localPhoto).mockRejectedValue(new Error("photo_unavailable"));
    await openApp("/page/page-1/photo");
    expect(await screen.findByText(fr.photo.loadFailed)).toBeTruthy();
  });
});

describe("the rich rendering of a page without network [6]", () => {
  async function openEnriched(): Promise<void> {
    await openApp("/page/page-1");
    await screen.findByText("Les suites");
  }

  test("shows the rendering that was kept and asks for no other", async () => {
    stored = { text: RENDERED, basedOn: renderingFingerprint(RAW) };
    goOffline();
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue("enriched");
    await openEnriched();
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(await screen.findByText("Les suites")).toBeTruthy();
    expect(render).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  test("lets the user choose the rich rendering when one is kept", async () => {
    stored = { text: RENDERED, basedOn: renderingFingerprint(RAW) };
    goOffline();
    await openEnriched();
    await fireEvent.press(await screen.findByLabelText(fr.rendering.enriched));
    await waitFor(() => expect(screen.getByLabelText(fr.rendering.enriched).props.accessibilityState?.selected).toBe(true));
    expect(alert).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  test("shows the sentence and stays on the faithful text when no rendering is kept", async () => {
    goOffline();
    await openEnriched();
    await fireEvent.press(await screen.findByLabelText(fr.rendering.enriched));
    await waitFor(() => expectRefused());
    expect(screen.getByLabelText(fr.rendering.faithful).props.accessibilityState?.selected).toBe(true);
    expect(render).not.toHaveBeenCalled();
  });

  test("a rendering kept for another text is not shown, and none is asked for", async () => {
    stored = { text: RENDERED, basedOn: "other" };
    goOffline();
    await openEnriched();
    await fireEvent.press(await screen.findByLabelText(fr.rendering.enriched));
    await waitFor(() => expectRefused());
    expect(render).not.toHaveBeenCalled();
  });
});
