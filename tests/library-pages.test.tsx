import { useLocales } from "expo-localization";
import { fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import type { NumberedPage } from "@/pages/pages";
import { pageService } from "@/pages/service";
import { granted, installPermission } from "./fake-camera";
import { installFakeNotebooks } from "./fake-notebook-service";
import { installFakePages, localMoment, page } from "./fake-page-service";
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
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn(), chapters: jest.fn(async () => []) },
}));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn(), words: jest.fn(async () => ({ words: [], corrections: [], gaps: [] })), correct: jest.fn(), edit: jest.fn(), alerts: jest.fn(async () => []) },
}));

const fr = strings.fr;
const en = strings.en;

const histoire = { id: "histoire-id", name: "Histoire", pageCount: 4 };
const sciences = { id: "sciences-id", name: "Sciences", pageCount: 1 };

const registered: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: null, blockedReason: null };
const anonymous: Allowance = { isAnonymous: true, used: 1, max: 3, remaining: 2, resetsAt: null, blockedReason: null };

const fernand = page({
  id: "fernand",
  notebookId: histoire.id,
  number: 1,
  capturedAt: localMoment(8, 25, 10, 0),
  text: "Fernand de Magellan\n\nNationalité: Portugaise\nProjet -> atteindre,\ndont iles Moluques\nMort -> 27/04/1521",
});
const jean = page({
  id: "jean",
  notebookId: histoire.id,
  number: 2,
  capturedAt: localMoment(8, 26, 10, 0),
  text: "Jean de la Fontaine.\n\nFabuliste",
});
const waiting = page({ id: "waiting", notebookId: histoire.id, number: 3, status: "processing", text: null, capturedAt: localMoment(8, 27, 10, 0) });
const deferred = page({
  id: "deferred",
  notebookId: histoire.id,
  number: 4,
  status: "queued",
  queueReason: "read_error",
  attemptedAt: new Date().toISOString(),
  text: null,
  capturedAt: localMoment(8, 28, 10, 0),
});
const failed = page({ id: "failed", notebookId: histoire.id, number: 5, status: "failed", text: null, capturedAt: localMoment(8, 29, 10, 0) });
const organic = page({
  id: "organic",
  notebookId: sciences.id,
  number: 1,
  capturedAt: localMoment(8, 24, 9, 0),
  text: "Organic Chemistry\nFormal Charge\nAtoms in molecules",
});

let pages: ReturnType<typeof installFakePages>;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(registered);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  installFakeNotebooks([histoire, sciences]);
  installPermission(granted);
  pages = installFakePages([fernand, jean, waiting, deferred, failed, organic]);
});

async function openApp(initialUrl = "/"): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return () => app.getPathname();
}

describe("the library", () => {
  test("shows the latest pages as cards, the newest first, with title, beginning of the text, notebook and date", async () => {
    await openApp();

    expect(await screen.findByText(fr.library.latestPages)).toBeTruthy();
    const card = await screen.findByText("Fernand de Magellan");
    expect(card).toBeTruthy();
    expect(screen.getByText("Nationalité: Portugaise\nProjet -> atteindre, dont iles Moluques\nMort -> 27/04/1521")).toBeTruthy();
    expect(screen.getByText(fr.library.cardMeta("Histoire", "25 sept."))).toBeTruthy();
    expect(screen.getByText("Jean de la Fontaine.")).toBeTruthy();
    expect(screen.getByText(fr.library.cardMeta("Sciences", "24 sept."))).toBeTruthy();
  });

  test("orders the cards from the newest page to the oldest", async () => {
    await openApp();
    await screen.findByText("Fernand de Magellan");

    const labels = screen.getAllByText(/^(Fernand de Magellan|Jean de la Fontaine\.|Organic Chemistry|Page \d)$/).map((node) => node.props.children as string);
    expect(labels).toEqual(["Page 5", "Page 4", "Page 3", "Jean de la Fontaine.", "Fernand de Magellan", "Organic Chemistry"]);
  });

  test("shows the state of a page that is not read, never an excerpt", async () => {
    await openApp();
    await screen.findByText("Fernand de Magellan");

    expect(screen.getByText(fr.document.stateInProgress)).toBeTruthy();
    expect(screen.getByText(fr.document.stateFailed)).toBeTruthy();
    expect(screen.getByText(/Lecture reportée · nouvel essai dans \d+ min/)).toBeTruthy();
  });

  test("shows ten cards at most", async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      page({
        id: `many-${index}`,
        notebookId: histoire.id,
        number: index + 1,
        capturedAt: localMoment(8, index + 1, 10, 0),
        text: `Titre numéro ${index + 1}\nCorps`,
      }),
    );
    pages = installFakePages(many);
    await openApp();
    await screen.findByText("Titre numéro 12");

    expect(screen.getAllByText(/^Titre numéro \d+$/)).toHaveLength(10);
    expect(screen.queryByText("Titre numéro 2")).toBeNull();
    expect(screen.getByText("Titre numéro 3")).toBeTruthy();
  });

  test("opens a page from its card", async () => {
    const pathname = await openApp();
    await fireEvent.press(await screen.findByText("Jean de la Fontaine."));

    expect(pathname()).toBe("/page/jean");
  });

  test("shows no latest pages before the first page", async () => {
    pages = installFakePages([]);
    await openApp();
    await screen.findByText(histoire.name);

    expect(screen.queryByText(fr.library.latestPages)).toBeNull();
  });

  test("gives, under each notebook, its number of pages and the date of its last page", async () => {
    await openApp();
    await screen.findByText("Fernand de Magellan");

    expect(screen.getByText(fr.notebook.pageCountAndDate(fr.notebook.pageCount(4), "29 sept."))).toBeTruthy();
    expect(screen.getByText(fr.notebook.pageCountAndDate(fr.notebook.pageCount(1), "24 sept."))).toBeTruthy();
  });

  test("gives only the number of pages under a notebook with no page to date", async () => {
    pages = installFakePages([organic]);
    await openApp();
    await screen.findByText("Organic Chemistry");

    expect(screen.getByText(fr.notebook.pageCount(4))).toBeTruthy();
    expect(screen.getByText(fr.notebook.pageCountAndDate(fr.notebook.pageCount(1), "24 sept."))).toBeTruthy();
  });

  test("still shows the notebooks when the pages cannot be loaded", async () => {
    jest.mocked(pageService.list).mockRejectedValue(new Error("offline"));
    await openApp();

    expect(await screen.findByText(histoire.name)).toBeTruthy();
    expect(screen.getByText(fr.notebook.pageCount(4))).toBeTruthy();
    expect(screen.queryByText(fr.library.latestPages)).toBeNull();
  });

  test("reminds an anonymous account with pages that its pages are linked to no account", async () => {
    jest.mocked(captureService.allowance).mockResolvedValue(anonymous);
    await openApp();

    expect(await screen.findByText(fr.library.anonymousReminder)).toBeTruthy();
  });

  test("does not remind an anonymous account that has no page", async () => {
    jest.mocked(captureService.allowance).mockResolvedValue(anonymous);
    pages = installFakePages([]);
    await openApp();
    await screen.findByText(histoire.name);

    expect(screen.queryByText(fr.library.anonymousReminder)).toBeNull();
  });

  test("does not remind an account that has been created", async () => {
    await openApp();
    await screen.findByText("Fernand de Magellan");

    expect(screen.queryByText(fr.library.anonymousReminder)).toBeNull();
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    jest.mocked(captureService.allowance).mockResolvedValue(anonymous);
    await openApp();

    expect(await screen.findByText(en.library.latestPages)).toBeTruthy();
    expect(screen.getByText(en.library.cardMeta("Histoire", "Sep 25"))).toBeTruthy();
    expect(screen.getByText(en.notebook.pageCountAndDate(en.notebook.pageCount(4), "Sep 29"))).toBeTruthy();
    expect(screen.getByText(en.library.anonymousReminder)).toBeTruthy();
    expect(screen.getByText(en.document.stateInProgress)).toBeTruthy();
  });
});

describe("a notebook", () => {
  const openNotebook = () => openApp(`/notebook/${histoire.id}`);

  test("lists its pages from the newest to the oldest, and only its own", async () => {
    await openNotebook();
    await screen.findByText("Fernand de Magellan");

    const rows = screen.getAllByText(/^(Fernand de Magellan|Jean de la Fontaine\.|Page \d)$/).map((node) => node.props.children as string);
    expect(rows).toEqual(["Page 5", "Page 4", "Page 3", "Jean de la Fontaine.", "Fernand de Magellan"]);
    expect(screen.queryByText("Organic Chemistry")).toBeNull();
  });

  test("shows a page that is read by its title, then its number and capture date, with no excerpt", async () => {
    await openNotebook();
    await screen.findByText("Fernand de Magellan");

    expect(screen.getByText(fr.document.info(1, "25 sept."))).toBeTruthy();
    expect(screen.getByText(fr.document.info(2, "26 sept."))).toBeTruthy();
    expect(screen.queryByText(/Nationalité/)).toBeNull();
  });

  test("shows a page that is not read by its number and its state", async () => {
    await openNotebook();
    await screen.findByText("Fernand de Magellan");

    expect(screen.getByText(fr.document.pageNumber(3))).toBeTruthy();
    expect(screen.getByText(fr.document.stateInProgress)).toBeTruthy();
    expect(screen.getByText(fr.document.pageNumber(4))).toBeTruthy();
    expect(screen.getByText(/Lecture reportée · nouvel essai dans \d+ min/)).toBeTruthy();
    expect(screen.getByText(fr.document.pageNumber(5))).toBeTruthy();
    expect(screen.getByText(fr.document.stateFailed)).toBeTruthy();
  });

  test("opens a page when it is pressed", async () => {
    const pathname = await openNotebook();
    await fireEvent.press(await screen.findByText("Jean de la Fontaine."));

    expect(pathname()).toBe("/page/jean");
  });

  test("shows a page that was being read as read, with no action, once its text is written [3]", async () => {
    await openNotebook();
    await screen.findByText(fr.document.stateInProgress);

    pages.change("waiting", { status: "read", text: "Albert Einstein\nPhysicien" });

    expect(await screen.findByText("Albert Einstein")).toBeTruthy();
    expect(screen.getByText(fr.document.info(3, "27 sept."))).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(fr.document.stateInProgress)).toBeNull());
  });

  test("keeps the empty notebook as it was", async () => {
    pages = installFakePages([]);
    jest.mocked(captureService.latestNotebookId).mockResolvedValue(null);
    installFakeNotebooks([{ ...histoire, pageCount: 0 }]);
    await openNotebook();

    expect(await screen.findByText(fr.notebook.emptyTitle)).toBeTruthy();
  });

  test("says so when the pages cannot be loaded, and loads them again on request", async () => {
    jest.mocked(pageService.list).mockRejectedValueOnce(new Error("offline"));
    await openNotebook();

    expect(await screen.findByText(fr.notebook.pagesLoadFailed)).toBeTruthy();
    await fireEvent.press(within(screen.getByText(fr.notebook.pagesLoadFailed).parent as never).getByText(fr.common.retry));

    expect(await screen.findByText("Fernand de Magellan")).toBeTruthy();
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openNotebook();

    expect(await screen.findByText(en.document.info(1, "Sep 25"))).toBeTruthy();
    expect(screen.getByText(en.document.stateFailed)).toBeTruthy();
  });
});

export type { NumberedPage };
