import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { pageService } from "@/pages/service";
import { granted, installPermission } from "./fake-camera";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { installFakePages, installFakeWords, page, regexWordsOf } from "./fake-page-service";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

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
  pageService: {
    list: jest.fn(),
    get: jest.fn(),
    photoUrl: jest.fn(),
    startReading: jest.fn(),
    setPageType: jest.fn(),
    words: jest.fn(),
    correct: jest.fn(),
    edit: jest.fn(),
    alerts: jest.fn(async () => []),
    second: jest.fn(async () => null),
  },
}));

const fr = strings.fr;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };

const UNDERLINED = "<u>La France</u>\n\nUne <u>belle</u> ligne";
const SPACED = "Titre\nUne ligne\n\nAutre ligne\n\nFin";
const TIGHT = "Titre\nUne ligne\nAutre ligne\nFin";

let pages: ReturnType<typeof installFakePages>;
let words: ReturnType<typeof installFakeWords>;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  installFakeNotebooks([histoire]);
  installPermission(granted);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function install(raw: string, overrides: Parameters<typeof page>[0] = {}): void {
  pages = installFakePages([page({ text: raw, ...overrides })]);
  words = installFakeWords(pages, "page-1", raw, regexWordsOf(raw));
}

async function openPage(firstText: string): Promise<void> {
  await renderRouter("./src/app", { initialUrl: "/page/page-1" });
  await screen.findByText(firstText);
}

async function startEditing(): Promise<void> {
  await fireEvent.press(await screen.findByText(fr.document.edit));
  await screen.findByLabelText(fr.document.editField);
}

const field = () => screen.getByLabelText(fr.document.editField);

async function save(): Promise<void> {
  await fireEvent.press(screen.getByText(fr.document.editSave));
}

async function saved(): Promise<void> {
  await waitFor(() => expect(screen.queryByLabelText(fr.document.editField)).toBeNull());
}

const gaps = () => screen.queryAllByTestId("page-gap").length;

describe("the underline tags [2]", () => {
  test("are not shown in the title or the blocks, and the stored text keeps them", async () => {
    install(UNDERLINED);
    await openPage("La France");

    expect(screen.queryByText(/<\/?u>/u)).toBeNull();
    expect(screen.getByText("Une belle ligne")).toBeTruthy();
    expect(pages.store[0].text).toBe(UNDERLINED);
  });

  test("leave an underlined word tappable, and a correction goes to that word", async () => {
    install(UNDERLINED);
    await openPage("La France");
    await fireEvent.press(await screen.findByText("belle"));

    const wordField = await screen.findByLabelText(fr.document.wordField);
    expect(wordField.props.value).toBe("belle");
    await fireEvent.changeText(wordField, "jolie");
    await fireEvent(wordField, "submitEditing");

    await waitFor(() => expect(words.written).toEqual([{ tokenIndex: regexWordsOf(UNDERLINED).findIndex((entry) => entry.text === "belle"), text: "jolie", chosenFrom: "keyboard" }]));
    await waitFor(() => expect(screen.getByText("Une jolie ligne")).toBeTruthy());
    expect(pages.store[0].text).toBe("<u>La France</u>\n\nUne <u>jolie</u> ligne");
  });

  test("are not in the field of the Edit mode, and saving without a change writes nothing", async () => {
    install(UNDERLINED);
    await openPage("La France");
    await startEditing();

    expect(field().props.value).toBe("La France\n\nUne belle ligne");
    await save();
    await saved();
    expect(pageService.edit).not.toHaveBeenCalled();
    expect(pages.store[0].text).toBe(UNDERLINED);
  });

  test("are dropped from the stored text when the page is edited, and nothing else is lost", async () => {
    install(UNDERLINED);
    await openPage("La France");
    await startEditing();
    await fireEvent.changeText(field(), "La France\n\nUne très belle ligne");
    await save();
    await saved();

    expect(words.edits).toHaveLength(1);
    expect(words.edits[0].text).toBe("La France\n\nUne très belle ligne");
    expect(pages.store[0].text).toBe("La France\n\nUne très belle ligne");
    expect(await screen.findByText("Une très belle ligne")).toBeTruthy();
  });

  test("never take the edit of a word next to them: the edit goes to the word, the tags are deleted", async () => {
    install(UNDERLINED);
    await openPage("La France");
    await startEditing();
    await fireEvent.changeText(field(), "Le France\n\nUne belle lignes");
    await save();
    await saved();

    const sent = words.edits[0].words;
    expect(sent.filter((entry) => entry.text !== "")).toEqual([
      { token_index: 1, text: "Le" },
      { token_index: 8, text: "lignes" },
    ]);
    expect(sent.filter((entry) => entry.text === "").map((entry) => entry.token_index)).toEqual([0, 3, 5, 7]);
    expect(pages.store[0].text).toBe("Le France\n\nUne belle lignes");
  });
});


const SECOND_WITHOUT_FIRST_BLANK = "Titre\nUne ligne\nAutre ligne\n\nFin";

const later = (milliseconds: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
  });

describe("the blank lines between the lines of the sheet [3]", () => {
  test("a blank line is shown as it is while the second reading is not known", async () => {
    install(SPACED);
    await openPage("Titre");

    expect(gaps()).toBe(2);
    await startEditing();
    expect(field().props.value).toBe(SPACED);
  });

  test("a blank line that the second reading does not have is not shown, nor in the field of the Edit mode", async () => {
    install(SPACED);
    jest.mocked(pageService.second).mockResolvedValue(SECOND_WITHOUT_FIRST_BLANK);
    await openPage("Titre");

    await waitFor(() => expect(gaps()).toBe(1));
    await startEditing();
    expect(field().props.value).toBe(SECOND_WITHOUT_FIRST_BLANK);
  });

  test("a blank line that the second reading has too is kept", async () => {
    install(SPACED);
    jest.mocked(pageService.second).mockResolvedValue(SPACED);
    await openPage("Titre");
    await waitFor(() => expect(pageService.second).toHaveBeenCalled());
    await later(100);

    expect(gaps()).toBe(2);
  });

  test("tightens the page when the second reading arrives after it", async () => {
    install(SPACED);
    jest.mocked(pageService.second).mockResolvedValueOnce(null).mockResolvedValue(TIGHT);
    await openPage("Titre");

    await waitFor(() => expect(gaps()).toBe(0));
    await startEditing();
    expect(field().props.value).toBe(TIGHT);
  });

  test("saving a tightened page without a change writes nothing, and the stored text keeps its blank lines", async () => {
    install(SPACED);
    jest.mocked(pageService.second).mockResolvedValue(TIGHT);
    await openPage("Titre");
    await waitFor(() => expect(gaps()).toBe(0));
    await startEditing();
    await save();
    await saved();

    expect(pageService.edit).not.toHaveBeenCalled();
    expect(pages.store[0].text).toBe(SPACED);
  });

  test("a word stays tappable after blank lines are removed", async () => {
    install(SPACED);
    jest.mocked(pageService.second).mockResolvedValue(TIGHT);
    await openPage("Titre");
    await waitFor(() => expect(gaps()).toBe(0));
    await fireEvent.press(await screen.findByText("Autre"));

    expect((await screen.findByLabelText(fr.document.wordField)).props.value).toBe("Autre");
  });

  test("a blank line that the user wrote is kept", async () => {
    install("Titre\nUne\nDeux");
    jest.mocked(pageService.second).mockResolvedValue("Titre\nUne\nDeux");
    await openPage("Titre");
    await startEditing();
    await fireEvent.changeText(field(), "Titre\nUne\n\nDeux");
    await save();
    await saved();

    await waitFor(() => expect(pages.store[0].text).toBe("Titre\nUne\n\nDeux"));
    await waitFor(() => expect(gaps()).toBe(1));
    await later(100);
    expect(gaps()).toBe(1);
  });

  test("a page of math is not changed and does not look for a second reading", async () => {
    install("$x = 1$\n\n$y = 2$", { pageType: "math" });
    jest.mocked(pageService.second).mockResolvedValue("$x = 1$\n$y = 2$");
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });
    await startEditing();

    expect(field().props.value).toBe("$x = 1$\n\n$y = 2$");
    expect(pageService.second).not.toHaveBeenCalled();
  });
});
