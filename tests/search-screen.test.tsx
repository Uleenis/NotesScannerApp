import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { StyleSheet } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import { strings } from "@/i18n";
import { notebookService } from "@/notebooks/service";
import { pageService } from "@/pages/service";
import type { SearchHit, SearchOutcome } from "@/search/search";
import { searchService } from "@/search/service";
import { histoire, installFakeNotebooks, sciences } from "./fake-notebook-service";
import { installFakePages, page } from "./fake-page-service";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("@/pages/timing", () => require("./fake-page-service").timing);
jest.mock("@/search/timing", () => ({ SEARCH_DELAY_MS: 10 }));
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
  captureService: { allowance: jest.fn(async () => null), latestNotebookId: jest.fn(async () => null), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: {
    list: jest.fn(),
    get: jest.fn(),
    photoUrl: jest.fn(),
    startReading: jest.fn(),
    setPageType: jest.fn(),
    words: jest.fn(async () => ({ words: [], corrections: [], gaps: [] })),
    correct: jest.fn(),
    edit: jest.fn(),
    alerts: jest.fn(async () => []),
    second: jest.fn(async () => null),
  },
}));
jest.mock("@/search/service", () => ({ searchService: { search: jest.fn(), anchor: jest.fn(async () => null) } }));

const fr = strings.fr;
const en = strings.en;

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    pageId: "page-1",
    notebookId: histoire.id,
    rank: 1,
    tokenIndex: 7,
    excerpt: "Fernand de Magellan",
    matchStart: 11,
    matchEnd: 19,
    alsoRead: null,
    ...overrides,
  };
}

function found(hits: SearchHit[], suggestions: { word: string; suggestion: string }[] = []): SearchOutcome {
  return { status: "found", hits, suggestions };
}

async function openApp(initialUrl: string) {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return { getPathname: () => app.getPathname(), getSearchParams: () => app.getSearchParams() };
}

async function type(label: string, text: string) {
  await fireEvent.changeText(await screen.findByLabelText(label), text);
}

async function chooseFromMenu(menuLabel: string, item: string): Promise<void> {
  await fireEvent.press(await screen.findByLabelText(menuLabel));
  const option = (await screen.findAllByTestId(/^action-sheet-option-/)).find((node) => node.props.accessibilityLabel === item);
  expect(option).toBeDefined();
  await fireEvent.press(option!);
}

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: false });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  installFakeNotebooks([histoire, sciences]);
  installFakePages([page({ id: "page-1", number: 4 }), page({ id: "page-2", number: 2, notebookId: sciences.id })]);
  jest.mocked(searchService.search).mockReset().mockResolvedValue(found([]));
  jest.mocked(searchService.anchor).mockReset().mockResolvedValue(null);
  jest.mocked(pageService.photoUrl).mockResolvedValue("https://photos.test/page-1.jpg");
});

describe("opening the search", () => {
  test("the library has a Search button that opens the search over every notebook", async () => {
    const app = await openApp("/");

    await fireEvent.press(await screen.findByText(fr.search.open));

    expect(app.getPathname()).toBe("/search");
    await type(fr.search.fieldLabel, "Magellan");
    await waitFor(() => expect(searchService.search).toHaveBeenCalledWith("Magellan", null));
  });

  test("the menu of a notebook opens the search already limited to it", async () => {
    const app = await openApp(`/notebook/${histoire.id}`);

    await chooseFromMenu(fr.notebook.menuLabel, fr.search.open);

    expect(app.getPathname()).toBe("/search");
    await type(fr.search.fieldLabel, "Magellan");
    await waitFor(() => expect(searchService.search).toHaveBeenCalledWith("Magellan", histoire.id));
  });

  test("a notebook that is not the user's is ignored", async () => {
    await openApp("/search?notebook=someone-else");
    await type(fr.search.fieldLabel, "Magellan");
    await waitFor(() => expect(searchService.search).toHaveBeenCalledWith("Magellan", null));
  });

  test("shows a hint, searches nothing for an empty field and caps the field at 100 characters", async () => {
    await openApp("/search");

    expect(await screen.findByText(fr.search.hint)).toBeTruthy();
    expect(screen.getByLabelText(fr.search.fieldLabel).props.maxLength).toBe(100);
    await type(fr.search.fieldLabel, "   ");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
    expect(searchService.search).not.toHaveBeenCalled();
  });
});

describe("the notebook filter", () => {
  test("lists every notebook and changes the notebook searched", async () => {
    await openApp("/search");
    await type(fr.search.fieldLabel, "Magellan");
    await waitFor(() => expect(searchService.search).toHaveBeenCalledWith("Magellan", null));

    await fireEvent.press(await screen.findByLabelText(fr.search.filterOption(sciences.name)));
    await waitFor(() => expect(searchService.search).toHaveBeenLastCalledWith("Magellan", sciences.id));

    await fireEvent.press(screen.getByLabelText(fr.search.filterOption(fr.search.allNotebooks)));
    await waitFor(() => expect(searchService.search).toHaveBeenLastCalledWith("Magellan", null));
  });

  test("marks the notebook searched as selected", async () => {
    await openApp(`/search?notebook=${sciences.id}`);

    const chip = await screen.findByLabelText(fr.search.filterOption(sciences.name));
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText(fr.search.filterOption(fr.search.allNotebooks)).props.accessibilityState).toMatchObject({ selected: false });
  });
});

describe("the results", () => {
  test("groups the pages under two titles, in the order of the answer, with the word in bold", async () => {
    jest.mocked(searchService.search).mockResolvedValue(
      found([
        hit(),
        hit({ pageId: "page-2", notebookId: sciences.id, rank: 2, tokenIndex: null, excerpt: "Fernand de Magelan", matchStart: null, matchEnd: null, alsoRead: "Magelan" }),
      ]),
    );
    await openApp("/search");
    await type(fr.search.fieldLabel, "Magellan");

    const inText = await screen.findByText(fr.search.inText);
    const alsoRead = screen.getByText(fr.search.alsoRead);
    expect(inText).toBeTruthy();
    expect(alsoRead).toBeTruthy();

    const bold = screen.getByText("Magellan");
    expect(StyleSheet.flatten(bold.props.style).fontWeight).toBe("700");
    expect(screen.getByText("Fernand de Magelan")).toBeTruthy();
    expect(screen.getByText(fr.search.alsoReadLine("Magelan"))).toBeTruthy();
    expect(screen.getByText(fr.library.cardMeta(histoire.name, fr.document.pageNumber(4)))).toBeTruthy();
    expect(screen.getByText(fr.library.cardMeta(sciences.name, fr.document.pageNumber(2)))).toBeTruthy();
  });

  test("shows no title for a rank that has no page", async () => {
    jest.mocked(searchService.search).mockResolvedValue(found([hit()]));
    await openApp("/search");
    await type(fr.search.fieldLabel, "Magellan");

    await screen.findByText(fr.search.inText);
    expect(screen.queryByText(fr.search.alsoRead)).toBeNull();
  });

  test("says when no page holds the words", async () => {
    await openApp("/search");
    await type(fr.search.fieldLabel, "Zanzibar");

    expect(await screen.findByText(fr.search.none)).toBeTruthy();
  });

  test("opens the page on the position found", async () => {
    jest.mocked(searchService.search).mockResolvedValue(found([hit()]));
    const app = await openApp("/search");
    await type(fr.search.fieldLabel, "Magellan");

    await fireEvent.press(await screen.findByText("Magellan"));

    await waitFor(() => expect(app.getPathname()).toBe("/page/page-1"));
    expect(app.getSearchParams()).toMatchObject({ found: "7" });
  });

  test("opens a page with no position on its text alone", async () => {
    jest.mocked(searchService.search).mockResolvedValue(found([hit({ rank: 2, tokenIndex: null, matchStart: null, matchEnd: null, alsoRead: "Magelan" })]));
    const app = await openApp("/search");
    await type(fr.search.fieldLabel, "Magellan");

    await fireEvent.press(await screen.findByText(fr.search.alsoReadLine("Magelan")));

    await waitFor(() => expect(app.getPathname()).toBe("/page/page-1"));
    expect(app.getSearchParams()).not.toHaveProperty("found");
  });

  test("searches again as the field is typed in, and again when it is submitted", async () => {
    await openApp("/search");
    const field = await screen.findByLabelText(fr.search.fieldLabel);

    await fireEvent.changeText(field, "Magel");
    await waitFor(() => expect(searchService.search).toHaveBeenCalledWith("Magel", null));
    await fireEvent.changeText(field, "Magellan");
    await fireEvent(field, "submitEditing");

    await waitFor(() => expect(searchService.search).toHaveBeenLastCalledWith("Magellan", null));
  });
});

describe("the suggestion", () => {
  test("offers the form of the lexicon and searches it on a tap", async () => {
    jest.mocked(searchService.search).mockImplementation(async (query) =>
      query === "Magellan" ? found([hit()]) : found([], [{ word: "magelan", suggestion: "Magellan" }]),
    );
    await openApp("/search");
    await type(fr.search.fieldLabel, "Magelan");

    await fireEvent.press(await screen.findByText(fr.search.didYouMean("Magellan")));

    await waitFor(() => expect(searchService.search).toHaveBeenLastCalledWith("Magellan", null));
    expect(screen.getByLabelText(fr.search.fieldLabel).props.value).toBe("Magellan");
    expect(await screen.findByText(fr.search.inText)).toBeTruthy();
    expect(screen.queryByText(fr.search.didYouMean("Magellan"))).toBeNull();
  });

  test("replaces only the word that has a suggestion", async () => {
    jest.mocked(searchService.search).mockResolvedValue(found([], [{ word: "magelan", suggestion: "Magellan" }]));
    await openApp("/search");
    await type(fr.search.fieldLabel, "Fernand Magelan");

    expect(await screen.findByText(fr.search.didYouMean("Fernand Magellan"))).toBeTruthy();
  });

  test("offers nothing when there is no suggestion", async () => {
    await openApp("/search");
    await type(fr.search.fieldLabel, "Zanzibar");

    await screen.findByText(fr.search.none);
    expect(screen.queryByText(/^Rechercher plutôt/)).toBeNull();
  });
});

describe("the refusals and the failures", () => {
  test.each([
    ["tooLong", fr.search.tooLong],
    ["tooManyWords", fr.search.tooManyWords],
    ["error", fr.search.failed],
  ] as const)("tells %s", async (status, message) => {
    jest.mocked(searchService.search).mockResolvedValue({ status });
    await openApp("/search");
    await type(fr.search.fieldLabel, "Magellan");

    expect(await screen.findByText(message)).toBeTruthy();
  });

  test("tells a call that throws as a failure", async () => {
    jest.mocked(searchService.search).mockRejectedValue(new Error("offline"));
    await openApp("/search");
    await type(fr.search.fieldLabel, "Magellan");

    expect(await screen.findByText(fr.search.failed)).toBeTruthy();
  });
});

test("every sentence of the screen exists in English", async () => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  jest.mocked(searchService.search).mockResolvedValue(
    found([hit({ rank: 2, tokenIndex: null, matchStart: null, matchEnd: null, alsoRead: "Magelan" })], [{ word: "magelan", suggestion: "Magellan" }]),
  );
  await openApp("/search");

  expect(await screen.findByText(en.search.hint)).toBeTruthy();
  await type(en.search.fieldLabel, "Magelan");
  expect(await screen.findByText(en.search.alsoRead)).toBeTruthy();
  expect(screen.getByText(en.search.alsoReadLine("Magelan"))).toBeTruthy();
  expect(screen.getByText(en.search.didYouMean("Magellan"))).toBeTruthy();
  expect(screen.getByLabelText(en.search.filterOption(en.search.allNotebooks))).toBeTruthy();
});
