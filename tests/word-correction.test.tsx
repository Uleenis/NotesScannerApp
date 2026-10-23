import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert, StyleSheet, type AlertButton } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { notebookService } from "@/notebooks/service";
import { pageService } from "@/pages/service";
import { colors } from "@/theme";
import { granted, installPermission } from "./fake-camera";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { installFakePages, installFakeWords, page, TEXT, TITLE, wordsOf } from "./fake-page-service";
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
    alerts: jest.fn(async () => []), second: jest.fn(async () => null),
  },
}));

const fr = strings.fr;
const en = strings.en;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };

const FIRST_GLUED = "Projet -> atteindre les Indes orientales, dont iles Moluques en Indonésie.";

let pages: ReturnType<typeof installFakePages>;
let words: ReturnType<typeof installFakeWords>;

function readingsOf(raw: string) {
  const all = wordsOf(raw);
  const at = (text: string) => all.findIndex((entry) => entry.text === text);
  return wordsOf(raw, {
    [at("iles")]: { readingA: "îles", readingB2: "isles" },
    [at("Portugaise")]: { readingA: "Portugaise", readingB2: "Portuguaise" },
  });
}

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  installFakeNotebooks([histoire]);
  installPermission(granted);
  pages = installFakePages([page()]);
  words = installFakeWords(pages, "page-1", TEXT, readingsOf(TEXT));
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function openPage(): Promise<void> {
  await renderRouter("./src/app", { initialUrl: "/page/page-1" });
  await screen.findByText(TITLE);
}

async function tapWord(word: string): Promise<void> {
  await fireEvent.press(await screen.findByText(word));
  await screen.findByLabelText(fr.document.wordField);
}

describe("tapping a word", () => {
  test("opens its field with the word in it, and marks it in the text [4, 11]", async () => {
    await openPage();
    await tapWord("Portugaise");

    expect(screen.getByLabelText(fr.document.wordField).props.value).toBe("Portugaise");
    expect(StyleSheet.flatten(screen.getAllByText("Portugaise")[0].props.style)?.backgroundColor).toBe(colors.highlight);
  });

  test("works on a word of the title as well", async () => {
    await openPage();
    await tapWord("Magellan");

    expect(screen.getByLabelText(fr.document.wordField).props.value).toBe("Magellan");
  });

  test("works on a word of lines glued together", async () => {
    await openPage();
    await tapWord("Moluques");

    expect(screen.getByLabelText(fr.document.wordField).props.value).toBe("Moluques");
  });

  test("shows the distinct readings of A, B1 and B2 above the field", async () => {
    await openPage();
    await tapWord("iles");

    expect(screen.getByLabelText(fr.document.wordSuggestions)).toBeTruthy();
    expect(screen.getByText("îles")).toBeTruthy();
    expect(screen.getByText("isles")).toBeTruthy();
    expect(screen.getAllByText("iles").length).toBeGreaterThanOrEqual(2);
  });

  test("shows the one reading there is when the passes agree", async () => {
    await openPage();
    await tapWord("Mort");

    expect(screen.queryByLabelText(fr.document.wordSuggestions)).toBeTruthy();
    expect(screen.getAllByText("Mort")).toHaveLength(2);
  });

  test("makes nothing editable on a page that has no word to place", async () => {
    pages.change("page-1", { text: "Titre\nUn mot" });
    jest.mocked(pageService.words).mockResolvedValue({ words: [], corrections: [], gaps: [] });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });
    await screen.findByText("Titre");

    expect(screen.getByText("Un mot")).toBeTruthy();
    await fireEvent.press(screen.getByText("Un mot"));
    expect(screen.queryByLabelText(fr.document.wordField)).toBeNull();
  });
});

describe("correcting a word with a suggestion", () => {
  test("adds a correction with the reading taken, and shows it where the word was [4, 11]", async () => {
    await openPage();
    await tapWord("iles");
    await fireEvent.press(screen.getByText("îles"));

    await waitFor(() => expect(words.written).toEqual([{ tokenIndex: 12, text: "îles", chosenFrom: "A" }]));
    expect(pageService.correct).toHaveBeenCalledWith("page-1", 12, "îles", "A");
    expect(await screen.findByText(FIRST_GLUED.replace("iles", "îles"))).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText(fr.document.wordField)).toBeNull());
  });

  test("takes the reading of B2 as such", async () => {
    await openPage();
    await tapWord("iles");
    await fireEvent.press(screen.getByText("isles"));

    await waitFor(() => expect(words.written).toEqual([{ tokenIndex: 12, text: "isles", chosenFrom: "B2" }]));
  });

  test("leaves every other word and line break where they were", async () => {
    await openPage();
    await tapWord("iles");
    await fireEvent.press(screen.getByText("isles"));
    await screen.findByText(FIRST_GLUED.replace("iles", "isles"));

    expect(screen.getByText("Nationalité: Portugaise")).toBeTruthy();
    expect(screen.getByText("Mort -> 27/04/1521")).toBeTruthy();
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  test("keeps the next words tappable where they now are", async () => {
    await openPage();
    await tapWord("iles");
    await fireEvent.press(screen.getByText("isles"));
    await screen.findByText(FIRST_GLUED.replace("iles", "isles"));

    await tapWord("Moluques");
    expect(screen.getByLabelText(fr.document.wordField).props.value).toBe("Moluques");
  });
});

describe("correcting a word with the keyboard", () => {
  test("adds a correction from the keyboard, with the Done button [4, 11]", async () => {
    await openPage();
    await tapWord("Portugaise");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), "Portugais");
    await fireEvent.press(screen.getByText(fr.common.done));

    await waitFor(() => expect(words.written).toEqual([{ tokenIndex: 4, text: "Portugais", chosenFrom: "keyboard" }]));
    expect(await screen.findByText("Nationalité: Portugais")).toBeTruthy();
  });

  test("adds it with the return key too", async () => {
    await openPage();
    await tapWord("Portugaise");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), "Portugais");
    await fireEvent(screen.getByLabelText(fr.document.wordField), "submitEditing");

    await waitFor(() => expect(words.written).toHaveLength(1));
  });

  test("shows the corrected word again after a second correction, in the last form", async () => {
    await openPage();
    await tapWord("Portugaise");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), "Portugais");
    await fireEvent.press(screen.getByText(fr.common.done));
    await screen.findByText("Nationalité: Portugais");

    await tapWord("Portugais");
    expect(screen.getByLabelText(fr.document.wordField).props.value).toBe("Portugais");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), "Portugaise");
    await fireEvent.press(screen.getByText(fr.common.done));

    await screen.findByText("Nationalité: Portugaise");
    expect(words.written.map((entry) => entry.text)).toEqual(["Portugais", "Portugaise"]);
  });

  test("writes nothing when the word is left as it is", async () => {
    await openPage();
    await tapWord("Portugaise");
    await fireEvent.press(screen.getByText(fr.common.done));

    await waitFor(() => expect(screen.queryByLabelText(fr.document.wordField)).toBeNull());
    expect(pageService.correct).not.toHaveBeenCalled();
  });

  test("writes nothing when cancelled", async () => {
    await openPage();
    await tapWord("Portugaise");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), "Portugais");
    await fireEvent.press(screen.getByText(fr.common.cancel));

    await waitFor(() => expect(screen.queryByLabelText(fr.document.wordField)).toBeNull());
    expect(pageService.correct).not.toHaveBeenCalled();
    expect(screen.getByText("Nationalité: Portugaise")).toBeTruthy();
  });

  test.each([
    ["with a space in it", "Portu gaise"],
    ["with nothing in it", ""],
    ["with more than 100 characters", "a".repeat(101)],
  ])("does not send a word %s, and says why", async (_, typed) => {
    await openPage();
    await tapWord("Portugaise");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), typed);

    expect(screen.getByText(fr.document.wordInvalid)).toBeTruthy();
    expect(screen.getByText(fr.common.done)).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.common.done));
    await fireEvent(screen.getByLabelText(fr.document.wordField), "submitEditing");
    expect(pageService.correct).not.toHaveBeenCalled();
  });

  test.each(["refused", "network", "error"] as const)("keeps the field open and says so when the correction fails (%s)", async (status) => {
    jest.mocked(pageService.correct).mockResolvedValueOnce({ status });
    await openPage();
    await tapWord("Portugaise");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), "Portugais");
    await fireEvent.press(screen.getByText(fr.common.done));

    expect(await screen.findByText(fr.document.wordSaveFailed)).toBeTruthy();
    expect(screen.getByLabelText(fr.document.wordField).props.value).toBe("Portugais");
    expect(screen.getByText("Nationalité: Portugaise")).toBeTruthy();
  });

  test("clears the problem on the next try, which can then succeed", async () => {
    jest.mocked(pageService.correct).mockRejectedValueOnce(new Error("offline"));
    await openPage();
    await tapWord("Portugaise");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), "Portugais");
    await fireEvent.press(screen.getByText(fr.common.done));
    await screen.findByText(fr.document.wordSaveFailed);

    await fireEvent.press(screen.getByText(fr.common.done));
    await waitFor(() => expect(screen.queryByText(fr.document.wordSaveFailed)).toBeNull());
    await screen.findByText("Nationalité: Portugais");
  });
});

describe("a page whose words cannot be used", () => {
  test("becomes tappable once A has written its words, without leaving the page", async () => {
    const all = readingsOf(TEXT);
    jest.mocked(pageService.words).mockResolvedValueOnce({ words: [], corrections: [], gaps: [] }).mockResolvedValue({ words: all, corrections: [], gaps: [] });
    await openPage();

    await fireEvent.press(await screen.findByText("Portugaise"));
    expect(await screen.findByLabelText(fr.document.wordField)).toBeTruthy();
    expect(jest.mocked(pageService.words).mock.calls.length).toBeGreaterThan(1);
  });

  test("looks again for its words a bounded number of times only", async () => {
    jest.mocked(pageService.words).mockResolvedValue({ words: [], corrections: [], gaps: [] });
    await openPage();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20 * 200);
    });

    expect(jest.mocked(pageService.words).mock.calls.length).toBeLessThanOrEqual(32);
    expect(jest.mocked(pageService.words).mock.calls.length).toBeGreaterThan(2);
  });

  test("is shown as it was read, with no word to tap, when the words could not be loaded", async () => {
    jest.mocked(pageService.words).mockRejectedValue(new Error("offline"));
    await openPage();

    expect(screen.getByText("Nationalité: Portugaise")).toBeTruthy();
    await fireEvent.press(screen.getByText("Nationalité: Portugaise"));
    expect(screen.queryByLabelText(fr.document.wordField)).toBeNull();
  });

  test("has no word to tap when the places do not fit the text", async () => {
    jest.mocked(pageService.words).mockResolvedValue({ words: wordsOf("Autre texte tout autre"), corrections: [], gaps: [] });
    await openPage();

    expect(screen.getByText("Nationalité: Portugaise")).toBeTruthy();
    await waitFor(() => expect(pageService.words).toHaveBeenCalled());
    expect(screen.queryByText("Portugaise")).toBeNull();
  });

  test("has no word to tap on a page of math", async () => {
    pages.change("page-1", { pageType: "math" });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });
    await screen.findByLabelText(fr.document.mathPage);

    expect(screen.queryAllByHintText(fr.document.wordHint)).toHaveLength(0);
  });

  test("has no word to tap on a page in another script", async () => {
    pages.change("page-1", { pageType: "unsupported_script" });
    await openPage();

    expect(pageService.words).not.toHaveBeenCalled();
  });
});

describe("in English", () => {
  test("speaks English in the field and its messages", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    jest.mocked(pageService.correct).mockResolvedValueOnce({ status: "error" });
    await openPage();
    await fireEvent.press(await screen.findByText("Portugaise"));

    const field = await screen.findByLabelText(en.document.wordField);
    await fireEvent.changeText(field, "Portu gaise");
    expect(screen.getByText(en.document.wordInvalid)).toBeTruthy();
    await fireEvent.changeText(field, "Portugais");
    await fireEvent.press(screen.getByText(en.common.done));
    expect(await screen.findByText(en.document.wordSaveFailed)).toBeTruthy();
    expect(screen.getByLabelText(en.document.wordSuggestions)).toBeTruthy();
  });
});

describe("switching a corrected page to math", () => {
  const buttonsOf = (alert: jest.SpyInstance<void, Parameters<typeof Alert.alert>>): AlertButton[] => alert.mock.calls[0]?.[2] ?? [];

  async function correctOnce(): Promise<void> {
    await tapWord("Portugaise");
    await fireEvent.changeText(screen.getByLabelText(fr.document.wordField), "Portugais");
    await fireEvent.press(screen.getByText(fr.common.done));
    await screen.findByText("Nationalité: Portugais");
    await waitFor(() => expect(jest.mocked(pageService.words).mock.calls.length).toBeGreaterThan(1));
  }

  test("asks first, and switches only when told to [4]", async () => {
    await openPage();
    await correctOnce();
    const alert = jest.spyOn(Alert, "alert");

    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);
    expect(alert).toHaveBeenCalledWith(fr.document.switchLosesTitle, fr.document.switchLosesBody, expect.any(Array));
    expect(pageService.setPageType).not.toHaveBeenCalled();

    await act(async () => {
      buttonsOf(alert)[1].onPress?.();
    });
    await waitFor(() => expect(pageService.setPageType).toHaveBeenCalledWith("page-1", "math"));
  });

  test("does nothing when the question is refused", async () => {
    await openPage();
    await correctOnce();
    const alert = jest.spyOn(Alert, "alert");

    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);
    expect(buttonsOf(alert)[0].style).toBe("cancel");
    expect(pageService.setPageType).not.toHaveBeenCalled();
    expect(screen.getByLabelText(fr.document.mathPage).props.value).toBe(false);
  });

  test("does not ask on a page with no correction", async () => {
    await openPage();
    await waitFor(() => expect(pageService.words).toHaveBeenCalled());
    await screen.findByText("Portugaise");
    const alert = jest.spyOn(Alert, "alert");

    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);
    await waitFor(() => expect(pageService.setPageType).toHaveBeenCalledWith("page-1", "math"));
    expect(alert).not.toHaveBeenCalled();
  });

  test("asks when it cannot tell whether the page has corrections", async () => {
    jest.mocked(pageService.words).mockRejectedValue(new Error("offline"));
    await openPage();
    const alert = jest.spyOn(Alert, "alert");

    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);
    expect(alert).toHaveBeenCalled();
    expect(pageService.setPageType).not.toHaveBeenCalled();
  });

  test("does not ask when a page of math goes back to text", async () => {
    pages.change("page-1", { pageType: "math" });
    await openPage();
    const alert = jest.spyOn(Alert, "alert");

    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", false);
    await waitFor(() => expect(pageService.setPageType).toHaveBeenCalledWith("page-1", "text"));
    expect(alert).not.toHaveBeenCalled();
  });
});
