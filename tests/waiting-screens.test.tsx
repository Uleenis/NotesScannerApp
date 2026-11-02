import { useLocales } from "expo-localization";
import { useNetworkState } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { sendWaitingNow } from "@/capture/queue-service";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { setMirrorStore } from "@/offline/mirror";
import { setOnline } from "@/offline/network";
import { enqueuePage, readQueue, updateQueued } from "@/offline/queue";
import { dismissNotices, noteLost, noteRejected } from "@/offline/queue-state";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";
import { installFakeLibrary } from "./fake-library";
import { fakeFiles, resetOffline } from "./fake-offline";
import { page } from "./fake-page-service";
import { USER, jpeg, uuid } from "./offline-fixtures";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));
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
jest.mock("@/capture/queue-service", () => ({
  ...jest.requireActual<typeof import("@/capture/queue-service")>("@/capture/queue-service"),
  sendWaitingNow: jest.fn(async () => undefined),
  realQueueDeps: () => ({
    now: () => Date.now(),
    targets: async () => ({ status: "network" }),
    send: async () => ({ status: "network", pageId: null }),
    refresh: () => undefined,
  }),
}));
jest.mock("@/offline/default-sync", () => {
  const refuse = async () => {
    throw new Error("no server in this test");
  };
  return {
    signedInUser: async () => require("./offline-fixtures").USER,
    defaultSyncDeps: () => ({ notebooks: refuse, chapters: refuse, pages: refuse, fetchPhoto: refuse, canDownload: () => false }),
  };
});

const fr = strings.fr;
const en = strings.en;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };

const histoire = { id: uuid(101), name: "Histoire" };
const sciences = { id: uuid(102), name: "Sciences" };
const moyenAge = { id: uuid(201), notebookId: histoire.id, name: "Moyen Âge" };

let store: AccountStore;
let alert: jest.SpyInstance;

function queueFiles(): string[] {
  return [...fakeFiles.keys()].filter((uri) => uri.includes("/queue/") && uri.endsWith(".bin"));
}

function wait(notebookId = histoire.id, chapterId: string | null = null, at = "2026-11-02T09:00:00.000Z", seed = 1): Promise<string> {
  return enqueuePage(store, { notebookId, chapterId, source: "camera", capturedAt: at }, jpeg(2000, seed));
}

beforeEach(async () => {
  resetOffline();
  dismissNotices();
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(useNetworkState).mockReturnValue({ isConnected: true, isInternetReachable: true });
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: USER, email: null, isAnonymous: false });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  jest.mocked(sendWaitingNow).mockClear();
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  setOnline(true);
  store = (await openAccountStore(USER)).store;
  setMirrorStore(store);
  installFakeLibrary({ notebooks: [histoire, sciences], chapters: [moyenAge], pages: [page({ id: "page-1", notebookId: histoire.id, number: 1 })] });
});

afterEach(async () => {
  alert.mockRestore();
  setMirrorStore(null);
  setOnline(true);
  await closeAccountStores();
});

async function openApp(initialUrl: string): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return () => app.getPathname();
}

describe("waiting pages on their screens [12]", () => {
  test("a notebook shows its waiting pages, newest first, with their state, next to its pages", async () => {
    await wait(histoire.id, null, "2026-11-01T09:00:00.000Z", 1);
    await wait(histoire.id, null, "2026-11-02T09:00:00.000Z", 2);
    await openApp(`/notebook/${histoire.id}`);

    const rows = await screen.findAllByText(fr.waiting.state);
    expect(rows).toHaveLength(2);
    expect(screen.getAllByText(/Page en attente/)[0]).toHaveTextContent("2 nov", { exact: false });
    expect(screen.getAllByText(/Page en attente/)[1]).toHaveTextContent("1 nov", { exact: false });
  });

  test("a notebook that only has waiting pages does not show its empty state", async () => {
    installFakeLibrary({ notebooks: [histoire, sciences], chapters: [moyenAge], pages: [] });
    await wait();
    await openApp(`/notebook/${histoire.id}`);

    expect(await screen.findByText(fr.waiting.state)).toBeTruthy();
    expect(screen.queryByText(fr.notebook.emptyTitle)).toBeNull();
  });

  test("a chapter shows its waiting pages and the notebook does not", async () => {
    await wait(histoire.id, moyenAge.id);
    const pathname = await openApp(`/chapter/${moyenAge.id}`);

    expect(await screen.findByText(fr.waiting.state)).toBeTruthy();
    expect(screen.queryByText(fr.chapter.emptyTitle)).toBeNull();
    expect(pathname()).toBe(`/chapter/${moyenAge.id}`);
  });

  test("the notebook of a chapter that is gone shows the page outside any chapter", async () => {
    await wait(histoire.id, uuid(299));
    await openApp(`/notebook/${histoire.id}`);

    expect(await screen.findByText(fr.waiting.state)).toBeTruthy();
  });

  test("a refused page shows its reason instead of the waiting state", async () => {
    const id = await wait();
    await updateQueued(store, id, { blocked: "monthly_limit" });
    await openApp(`/notebook/${histoire.id}`);

    expect(await screen.findByText(fr.waiting.blocked.monthly_limit)).toBeTruthy();
    expect(screen.queryByText(fr.waiting.state)).toBeNull();
  });

  test("a page appears at once when it enters the queue", async () => {
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(histoire.name);
    expect(screen.queryByText(fr.waiting.state)).toBeNull();
    await act(async () => {
      await wait();
    });

    expect(await screen.findByText(fr.waiting.state)).toBeTruthy();
  });

  test("the screens speak English on an English phone [14]", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await wait();
    await openApp(`/notebook/${histoire.id}`);

    expect(await screen.findByText(en.waiting.state)).toBeTruthy();
  });
});

describe("a waiting page, opened [12]", () => {
  async function openWaiting(): Promise<{ id: string; pathname: () => string }> {
    const id = await wait();
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await fireEvent.press(await screen.findByText(fr.waiting.state));
    await screen.findByText(fr.waiting.body);
    return { id, pathname };
  }

  test("shows its photo and the sentence, and works without a network", async () => {
    jest.mocked(useNetworkState).mockReturnValue({ isConnected: false, isInternetReachable: false });
    const { id, pathname } = await openWaiting();

    expect(pathname()).toBe(`/waiting/${id}`);
    await waitFor(() => expect(screen.getByLabelText(fr.photo.label)).toBeTruthy());
    expect(screen.getByText(fr.waiting.delete)).toBeTruthy();
    expect(screen.queryByText(fr.waiting.chooseNotebook)).toBeNull();
  });

  test("writes the clear photo only for the display and erases it when the page closes", async () => {
    await openWaiting();
    await waitFor(() => expect(screen.getByLabelText(fr.photo.label)).toBeTruthy());
    const shown = [...fakeFiles.keys()].filter((uri) => uri.includes("/offline-view/"));
    expect(shown).toHaveLength(1);

    await act(async () => {
      screen.unmount();
    });
    expect([...fakeFiles.keys()].filter((uri) => uri.includes("/offline-view/"))).toEqual([]);
  });

  test("asks before deleting, then removes the page, its photo, and goes back", async () => {
    const { pathname } = await openWaiting();
    await fireEvent.press(screen.getByText(fr.waiting.delete));

    expect(alert).toHaveBeenCalledWith(fr.waiting.deleteTitle, fr.waiting.deleteBody, expect.any(Array));
    expect(await readQueue(store)).toHaveLength(1);
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as { style?: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((button) => button.style === "destructive")?.onPress?.();
    });

    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
    expect(await readQueue(store)).toEqual([]);
    expect(queueFiles()).toEqual([]);
    expect(screen.queryByText(fr.waiting.state)).toBeNull();
  });

  test("keeps the page when the deletion is cancelled", async () => {
    await openWaiting();
    await fireEvent.press(screen.getByText(fr.waiting.delete));
    const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as { style?: string }[];

    expect(buttons.find((button) => button.style === "cancel")).toBeDefined();
    expect(await readQueue(store)).toHaveLength(1);
  });

  test("a page that is no longer in the queue sends back to the library", async () => {
    const id = await wait();
    const pathname = await openApp(`/waiting/${id}`);
    await screen.findByText(fr.waiting.body);
    await act(async () => {
      await store.database.runAsync("delete from queue");
      const { announceQueue } = jest.requireActual<typeof import("@/offline/queue-state")>("@/offline/queue-state");
      announceQueue();
    });

    await waitFor(() => expect(pathname()).toBe("/"));
  });
});

describe("a page whose notebook is gone [11]", () => {
  const gone = uuid(150);

  async function lost(): Promise<string> {
    const id = await wait(gone);
    await updateQueued(store, id, { blocked: "notebook", pageId: uuid(900) });
    return id;
  }

  test("is listed in the library with its reason, since no notebook shows it", async () => {
    await lost();
    await openApp("/");

    expect(await screen.findByText(fr.waiting.blocked.notebook)).toBeTruthy();
  });

  test("offers to choose a notebook, sends the page to the notebook chosen and starts the sending", async () => {
    const id = await lost();
    await openApp("/");
    await fireEvent.press(await screen.findByText(fr.waiting.blocked.notebook));
    expect(await screen.findByText(fr.waiting.notebookGone)).toBeTruthy();

    await fireEvent.press(screen.getByText(fr.waiting.chooseNotebook));
    await fireEvent.press(await screen.findByText(sciences.name));

    await waitFor(() => expect(sendWaitingNow).toHaveBeenCalledTimes(1));
    const [entry] = await readQueue(store);
    expect(entry).toMatchObject({ id, notebookId: sciences.id, chapterId: null, blocked: null, pageId: null });
  });
});

describe("what the queue tells the user [12]", () => {
  test("says how many waiting pages were lost with the key, and that stays until it is dismissed", async () => {
    noteLost(2);
    await openApp("/");

    expect(await screen.findByText(fr.waiting.lost(2))).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.limit.understood));
    expect(screen.queryByText(fr.waiting.lost(2))).toBeNull();
  });

  test("says how many waiting pages the server refused and removed", async () => {
    await openApp("/");
    await screen.findByText(histoire.name);
    await act(async () => noteRejected(1));

    expect(await screen.findByText(fr.waiting.rejected(1))).toBeTruthy();
  });
});
