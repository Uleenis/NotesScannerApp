import { useLocales } from "expo-localization";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { act } from "@testing-library/react-native";
import { Alert, Keyboard, ScrollView, StyleSheet, View, type KeyboardEvent } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { pageService } from "@/pages/service";
import { granted, installPermission } from "./fake-camera";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { installFakePages, installFakeWords, page, regexWordsOf, TEXT, TITLE } from "./fake-page-service";
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
  pages = installFakePages([page()]);
  words = installFakeWords(pages, "page-1", TEXT, regexWordsOf(TEXT));
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function openPage(): Promise<void> {
  await renderRouter("./src/app", { initialUrl: "/page/page-1" });
  await screen.findByText(TITLE);
}

async function startEditing(): Promise<void> {
  await openPage();
  await fireEvent.press(await screen.findByText(fr.document.edit));
  await screen.findByLabelText(fr.document.editField);
}

const field = () => screen.getByLabelText(fr.document.editField);

async function type(text: string): Promise<void> {
  await fireEvent.changeText(field(), text);
}

async function save(): Promise<void> {
  await fireEvent.press(screen.getByText(fr.document.editSave));
}

async function saved(): Promise<void> {
  await waitFor(() => expect(screen.queryByLabelText(fr.document.editField)).toBeNull());
}

const indexOf = (word: string): number => regexWordsOf(TEXT).findIndex((entry) => entry.text === word);

describe("the Edit button", () => {
  test("is on a page of text once its words are placed [6, 11]", async () => {
    await openPage();

    expect(await screen.findByText(fr.document.edit)).toBeTruthy();
  });

  test("is on a page of math", async () => {
    pages.change("page-1", { pageType: "math", text: "$x = 1$" });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });

    expect(await screen.findByText(fr.document.edit)).toBeTruthy();
  });

  test("is not on a page in another script", async () => {
    pages.change("page-1", { pageType: "unsupported_script" });
    await openPage();

    expect(screen.queryByText(fr.document.edit)).toBeNull();
  });

  test("is not on a page that is not read", async () => {
    pages.change("page-1", { status: "processing", text: null });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });
    await screen.findByText(fr.reading.waitingTitle);

    expect(screen.queryByText(fr.document.edit)).toBeNull();
  });

  test("is not on a page of text whose words cannot be placed", async () => {
    jest.mocked(pageService.words).mockResolvedValue({ words: [], corrections: [], gaps: [] });
    await openPage();
    await waitFor(() => expect(pageService.words).toHaveBeenCalled());

    expect(screen.queryByText(fr.document.edit)).toBeNull();
  });
});

describe("editing the whole page", () => {
  test("turns the text into one field holding the text of the page, and Cancel leaves it alone [6]", async () => {
    await startEditing();

    expect(field().props.value).toBe(TEXT);
    await fireEvent.press(screen.getByText(fr.common.cancel));
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(pageService.edit).not.toHaveBeenCalled();
  });

  test("closes without a call when nothing was changed", async () => {
    await startEditing();
    await save();
    await saved();
    expect(pageService.edit).not.toHaveBeenCalled();
  });

  test("sends a changed word as a correction, an added word as text of the user, and shows the new text [6]", async () => {
    const edited = TEXT.replace("Portugaise", "Portugais").replace("iles Moluques", "iles lointaines Moluques");
    await startEditing();
    await type(edited);
    await save();
    await saved();
    expect(pageService.edit).toHaveBeenCalledTimes(1);
    const sent = words.edits[0];
    expect(sent.text).toBe(edited);
    expect(sent.words).toEqual([{ token_index: indexOf("Portugaise"), text: "Portugais" }]);
    expect(sent.gaps).toEqual([{ gap_index: indexOf("Moluques"), text: " lointaines " }]);
    expect(await screen.findByText("Nationalité: Portugais")).toBeTruthy();
    expect(screen.getByText(/lointaines/u)).toBeTruthy();
  });

  test("keeps the words of the edited page tappable [4]", async () => {
    await startEditing();
    await type(TEXT.replace("Mort", "Décès tragique"));
    await save();
    await saved();

    await fireEvent.press(await screen.findByText("Décès"));
    expect((await screen.findByLabelText(fr.document.wordField)).props.value).toBe("Décès");
  });

  test("sends a deleted word as a correction with no text", async () => {
    await startEditing();
    await type(TEXT.replace("Nationalité: Portugaise", "Portugaise"));
    await save();
    await saved();
    expect(words.edits[0].words).toContainEqual({ token_index: indexOf("Nationalité"), text: "" });
  });

  test("sends a cut line as text of the user and no correction [6]", async () => {
    await startEditing();
    await type(TEXT.replace("dont iles", "dont\niles"));
    await save();
    await saved();
    expect(words.edits[0].words).toEqual([]);
    expect(words.edits[0].gaps).toEqual([{ gap_index: indexOf("iles"), text: "\n" }]);
  });

  test("sends the whole text of a page of math as one gap", async () => {
    pages.change("page-1", { pageType: "math", text: "$x = 1$" });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });
    await fireEvent.press(await screen.findByText(fr.document.edit));
    await screen.findByLabelText(fr.document.editField);
    await type("$x = 2$");
    await save();

    await waitFor(() => expect(pageService.edit).toHaveBeenCalledWith("page-1", "$x = 2$", [], [{ gap_index: 0, text: "$x = 2$" }]));
  });

  test.each([
    ["a failure", { status: "error" as const }, fr.document.editSaveFailed],
    ["no network", { status: "network" as const }, fr.document.editSaveFailed],
    ["a refusal", { status: "refused" as const }, fr.document.editRefused],
    ["a page that changed", { status: "changed" as const }, fr.document.editChanged],
  ])("keeps the field and says it when the server answers %s", async (_, result, sentence) => {
    await startEditing();
    jest.mocked(pageService.edit).mockResolvedValue(result);
    await type(`${TEXT} Fin`);
    await save();

    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(field().props.value).toBe(`${TEXT} Fin`);
  });

  test("says when the edit is too large, without a call", async () => {
    await startEditing();
    await type("x".repeat(100_001));
    await save();

    expect(await screen.findByText(fr.document.editTooBig)).toBeTruthy();
    expect(pageService.edit).not.toHaveBeenCalled();
  });

  test("speaks English when the phone does", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openPage();
    await fireEvent.press(await screen.findByText(en.document.edit));
    await fireEvent.changeText(await screen.findByLabelText(en.document.editField), `${TEXT} End`);
    jest.mocked(pageService.edit).mockResolvedValueOnce({ status: "error" });
    await fireEvent.press(screen.getByText(en.document.editSave));

    expect(await screen.findByText(en.document.editSaveFailed)).toBeTruthy();
  });
});

describe("the alerts next to the title", () => {
  test("says in a neutral sentence that a line may not have been copied", async () => {
    jest.mocked(pageService.alerts).mockResolvedValue(["missing_line"]);
    await openPage();

    expect(await screen.findByText(fr.document.alertMissingLine)).toBeTruthy();
    expect(screen.queryByText(fr.document.alertMathIncomplete)).toBeNull();
  });

  test("says that a statement may not have been copied on a page of math", async () => {
    jest.mocked(pageService.alerts).mockResolvedValue(["math_incomplete"]);
    pages.change("page-1", { pageType: "math", text: "$x = 1$" });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });

    expect(await screen.findByText(fr.document.alertMathIncomplete)).toBeTruthy();
  });

  test("says that the date of the page does not follow the notebook", async () => {
    jest.mocked(pageService.alerts).mockResolvedValue(["date_incoherent"]);
    await openPage();

    expect(await screen.findByText(fr.document.alertDateIncoherent)).toBeTruthy();
    expect(screen.queryByText(fr.document.alertMissingLine)).toBeNull();
  });

  test("shows the date alert next to another one", async () => {
    jest.mocked(pageService.alerts).mockResolvedValue(["date_incoherent", "missing_line"]);
    await openPage();

    expect(await screen.findByText(fr.document.alertDateIncoherent)).toBeTruthy();
    expect(await screen.findByText(fr.document.alertMissingLine)).toBeTruthy();
  });

  test("does not show the date alert on a page of math", async () => {
    jest.mocked(pageService.alerts).mockResolvedValue(["date_incoherent"]);
    pages.change("page-1", { pageType: "math", text: "$x = 1$" });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });
    await waitFor(() => expect(pageService.alerts).toHaveBeenCalledWith("page-1"));

    expect(screen.queryByText(fr.document.alertDateIncoherent)).toBeNull();
  });

  test("reads the alerts again after an edit, so a fixed date loses its alert", async () => {
    let fixed = false;
    jest.mocked(pageService.alerts).mockImplementation(async () => (fixed ? [] : ["date_incoherent"]));
    await openPage();
    expect(await screen.findByText(fr.document.alertDateIncoherent)).toBeTruthy();
    await fireEvent.press(await screen.findByText(fr.document.edit));
    await screen.findByLabelText(fr.document.editField);
    await type(`${TEXT} Fin`);
    fixed = true;
    await save();
    await saved();

    await waitFor(() => expect(screen.queryByText(fr.document.alertDateIncoherent)).toBeNull());
  });

  test("shows an alert that is written after the page is on screen", async () => {
    jest.mocked(pageService.alerts).mockResolvedValueOnce([]).mockResolvedValue(["missing_line"]);
    await openPage();

    expect(await screen.findByText(fr.document.alertMissingLine)).toBeTruthy();
  });

  test("shows nothing when the page has no alert", async () => {
    await openPage();
    await waitFor(() => expect(pageService.alerts).toHaveBeenCalledWith("page-1"));

    expect(screen.queryByText(fr.document.alertMissingLine)).toBeNull();
    expect(screen.queryByText(fr.document.alertMathIncomplete)).toBeNull();
  });

  test("does not look for alerts on a page that is not read", async () => {
    pages.change("page-1", { status: "processing", text: null });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });
    await screen.findByText(fr.reading.waitingTitle);

    expect(pageService.alerts).not.toHaveBeenCalled();
  });

  test("is in English when the phone is", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    jest.mocked(pageService.alerts).mockResolvedValue(["missing_line"]);
    await openPage();

    expect(await screen.findByText(en.document.alertMissingLine)).toBeTruthy();
  });

  test("says the date alert in English when the phone is", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    jest.mocked(pageService.alerts).mockResolvedValue(["date_incoherent"]);
    await openPage();

    expect(await screen.findByText(en.document.alertDateIncoherent)).toBeTruthy();
  });
});

describe("switching the type of an edited page", () => {
  test("asks first when the page holds text of the user", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await startEditing();
    await type(`${TEXT} Fin`);
    await save();
    await saved();

    await fireEvent(await screen.findByLabelText(fr.document.mathPage), "valueChange", true);
    expect(alert).toHaveBeenCalledWith(fr.document.switchLosesTitle, fr.document.switchLosesBody, expect.any(Array));
    expect(pageService.setPageType).not.toHaveBeenCalled();
  });

  test("asks first when a page of math may hold edits", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    pages.change("page-1", { pageType: "math", text: "$x = 2$" });
    jest.mocked(pageService.words).mockResolvedValue({ words: [], corrections: [], gaps: [{ index: 0, text: "$x = 2$" }] });
    await renderRouter("./src/app", { initialUrl: "/page/page-1" });

    await waitFor(() => expect(pageService.words).toHaveBeenCalled());
    await fireEvent(await screen.findByLabelText(fr.document.mathPage), "valueChange", false);
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(pageService.setPageType).not.toHaveBeenCalled();
  });
});

describe("above the keyboard", () => {
  let listeners: Array<(event: KeyboardEvent) => void>;

  beforeEach(() => {
    listeners = [];
    jest.spyOn(Keyboard, "addListener").mockImplementation(((name: string, listener: (event: KeyboardEvent) => void) => {
      if (name === "keyboardDidShow" || name === "keyboardWillChangeFrame") {
        listeners.push(listener);
      }
      return { remove: () => undefined };
    }) as never);
    (View.prototype as unknown as { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void }).measureInWindow = (
      callback,
    ) => callback(0, 56, 360, 744);
  });

  async function raiseKeyboard(): Promise<void> {
    await act(async () => {
      listeners.forEach((listener) => listener({ endCoordinates: { screenY: 500, height: 300, width: 360, screenX: 0 } } as KeyboardEvent));
    });
  }

  function liftOf(node: ReturnType<typeof screen.getByText>): number {
    let found = 0;
    for (let at: typeof node | null = node; at !== null; at = at.parent) {
      const style = StyleSheet.flatten(at.props.style) as { paddingBottom?: number } | undefined;
      found = Math.max(found, style?.paddingBottom ?? 0);
    }
    return found;
  }

  test("the correction bar is lifted by the keyboard under a header [9]", async () => {
    await openPage();
    await fireEvent.press(await screen.findByText("Portugaise"));
    const bar = await screen.findByLabelText(fr.document.wordField);
    await raiseKeyboard();

    expect(liftOf(bar)).toBe(300);
  });

  test("the Edit bar is lifted by the keyboard under a header [9]", async () => {
    await startEditing();
    await raiseKeyboard();

    expect(liftOf(screen.getByText(fr.document.editSave))).toBe(300);
  });

  describe("the tapped word", () => {
    let scrollTo: jest.Mock;

    beforeEach(() => {
      scrollTo = jest.fn();
      (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo = scrollTo;
    });

    async function tapAt(word: string, pageY: number): Promise<void> {
      await openPage();
      let scroller: ReturnType<typeof screen.getByText> | null = screen.getByText(word);
      while (scroller !== null && scroller.props.scrollEventThrottle !== 16) {
        scroller = scroller.parent;
      }
      if (scroller === null) {
        throw new Error("no scroll view");
      }
      await act(async () => {
        scroller.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 400 } } });
      });
      await fireEvent.press(await screen.findByText(word), { nativeEvent: { pageY } });
      await screen.findByLabelText(fr.document.wordField);
    }

    test("is scrolled above the bar when the bar and the keyboard would cover it [9]", async () => {
      await tapAt("Portugaise", 56 + 390);

      await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
      const { y } = scrollTo.mock.calls[0][0] as { y: number };
      expect(y).toBeGreaterThan(0);
    });

    test("is left where it is when it already shows above the bar", async () => {
      await tapAt("Portugaise", 56 + 100);

      expect(scrollTo).not.toHaveBeenCalled();
    });
  });

  test("the Edit field fills the space above the bar, so the keyboard cursor stays in view [9]", async () => {
    await startEditing();

    const style = StyleSheet.flatten(field().props.style) as { flex?: number };
    expect(style.flex).toBe(1);
    expect(field().props.scrollEnabled).not.toBe(false);
  });
});
