import { useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { pageService } from "@/pages/service";
import { strings } from "@/i18n";
import { renderingFingerprint, type RenderOutcome, type StoredRendering } from "@/render/api";
import { resetRenderMode } from "@/render/mode";
import { renderService } from "@/render/service";
import { resetRenderAttempts } from "@/render/use-rendering";
import { granted, installPermission } from "./fake-camera";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { installFakePages, installFakeWords, page, regexWordsOf } from "./fake-page-service";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
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
jest.mock("@/render/service", () => ({ renderService: { read: jest.fn(), render: jest.fn() } }));
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
const en = strings.en;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };

const RAW = "Les suites\nUne suite converge si elle est bornée.\nExemples\nLa suite 1/n";
const RENDERED = "# Les suites\n\nUne suite converge si elle est **bornée**.\n\n## Exemples\n\n- La suite 1/n";

let pages: ReturnType<typeof installFakePages>;
let words: ReturnType<typeof installFakeWords>;
let stored: StoredRendering | null;

const read = jest.mocked(renderService.read);
const render = jest.mocked(renderService.render);
const getItem = jest.mocked(SecureStore.getItemAsync);
const setItem = jest.mocked(SecureStore.setItemAsync);

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  installFakeNotebooks([histoire]);
  installPermission(granted);
  pages = installFakePages([page({ text: RAW })]);
  words = installFakeWords(pages, "page-1", RAW, regexWordsOf(RAW));
  stored = null;
  resetRenderMode();
  resetRenderAttempts();
  getItem.mockReset().mockResolvedValue(null);
  setItem.mockReset().mockResolvedValue(undefined);
  read.mockReset().mockImplementation(async () => stored);
  render.mockReset().mockResolvedValue({ status: "ready", text: RENDERED });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function openPage(first: string = RAW.split("\n")[0]): Promise<void> {
  await renderRouter("./src/app", { initialUrl: "/page/page-1" });
  await screen.findByText(first);
}

const choose = async (label: string) => fireEvent.press(await screen.findByLabelText(label));

const selected = (label: string) => screen.getByLabelText(label).props.accessibilityState?.selected === true;

async function showEnriched(): Promise<void> {
  await choose(fr.rendering.enriched);
  await screen.findByText("•");
}

describe("the switch between the faithful text and the rendering [6]", () => {
  test("starts on the faithful text and calls nothing", async () => {
    await openPage();

    expect(selected(fr.rendering.faithful)).toBe(true);
    expect(selected(fr.rendering.enriched)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(screen.queryByText("•")).toBeNull();
  });

  test("shows the structure of the rendering, the words unchanged, once Formatted is chosen [4]", async () => {
    await openPage();
    await showEnriched();

    expect(selected(fr.rendering.enriched)).toBe(true);
    expect(screen.getByText("Les suites")).toBeTruthy();
    expect(screen.getByText("Exemples")).toBeTruthy();
    expect(screen.getByText("bornée")).toBeTruthy();
    expect(screen.getByText("La suite 1/n")).toBeTruthy();
    expect(screen.queryByText(/\*\*|^#/u)).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith("page-1");
    expect(screen.queryByText(fr.rendering.waiting)).toBeNull();
  });

  test("shows the wait while the rendering is made, with the faithful text kept", async () => {
    let finish: (outcome: RenderOutcome) => void = () => undefined;
    render.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openPage();
    await choose(fr.rendering.enriched);

    expect(await screen.findByText(fr.rendering.waiting)).toBeTruthy();
    expect(screen.getByText(/Une suite converge si elle est bornée\./u)).toBeTruthy();
    await act(async () => finish({ status: "ready", text: RENDERED }));
    await screen.findByText("•");
    expect(screen.queryByText(fr.rendering.waiting)).toBeNull();
  });

  test("serves a current stored rendering without any call [4]", async () => {
    stored = { text: RENDERED, basedOn: renderingFingerprint(RAW) };
    await openPage();
    await showEnriched();

    expect(render).not.toHaveBeenCalled();
  });

  test("asks again when the stored rendering is for another text [4]", async () => {
    stored = { text: "# Ancien", basedOn: renderingFingerprint("autre texte") };
    await openPage();
    await showEnriched();

    expect(render).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ancien")).toBeNull();
  });

  test("keeps the choice for the next opening, and on the phone", async () => {
    await openPage();
    await choose(fr.rendering.enriched);
    await screen.findByText("•");
    expect(setItem).toHaveBeenCalledWith("render-mode", "enriched");

    resetRenderMode();
    resetRenderAttempts();
    getItem.mockResolvedValue("enriched");
    stored = { text: RENDERED, basedOn: renderingFingerprint(RAW) };
    await openPage();
    await screen.findByText("•");
    expect(selected(fr.rendering.enriched)).toBe(true);
  });

  test("goes back to the faithful text with the Faithful choice, and remembers it", async () => {
    await openPage();
    await showEnriched();
    await choose(fr.rendering.faithful);

    await waitFor(() => expect(screen.queryByText("•")).toBeNull());
    expect(setItem).toHaveBeenLastCalledWith("render-mode", "faithful");
  });

  test("goes back to the faithful text when the text is touched, without changing the choice [6]", async () => {
    await openPage();
    await showEnriched();
    setItem.mockClear();
    await fireEvent.press(screen.getByText("La suite 1/n"));

    await waitFor(() => expect(screen.queryByText("•")).toBeNull());
    expect(selected(fr.rendering.faithful)).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  test("goes back to the faithful text and opens the edit field with Edit [6]", async () => {
    await openPage();
    await showEnriched();
    await fireEvent.press(screen.getByText(fr.document.edit));

    expect(await screen.findByLabelText(fr.document.editField)).toBeTruthy();
    expect(screen.queryByText("•")).toBeNull();
  });
});

describe("when the rendering cannot be shown", () => {
  test.each(["discarded", "failed", "limit", "network", "error"] as const)("a %s answer keeps the faithful text with the neutral sentence, and asks only once [4, 6]", async (status) => {
    render.mockResolvedValue({ status });
    await openPage();
    await choose(fr.rendering.enriched);

    expect(await screen.findByText(fr.rendering.fallback)).toBeTruthy();
    expect(screen.getByText(/Une suite converge si elle est bornée\./u)).toBeTruthy();
    expect(screen.queryByText("•")).toBeNull();
    expect(screen.queryByText(fr.rendering.waiting)).toBeNull();
    await act(async () => {});
    expect(render).toHaveBeenCalledTimes(1);
  });

  test.each(["failed", "network", "error", "limit"] as const)("does not ask again on a new opening of the same text after %s, but does after an explicit choice", async (status) => {
    render.mockResolvedValue({ status });
    await openPage();
    await choose(fr.rendering.enriched);
    await screen.findByText(fr.rendering.fallback);

    await choose(fr.rendering.faithful);
    await waitFor(() => expect(screen.queryByText(fr.rendering.fallback)).toBeNull());
    expect(render).toHaveBeenCalledTimes(1);

    render.mockResolvedValue({ status: "ready", text: RENDERED });
    await choose(fr.rendering.enriched);
    await screen.findByText("•");
    expect(render).toHaveBeenCalledTimes(2);
  });

  test("never asks again for a text whose rendering was discarded, whatever the choice", async () => {
    render.mockResolvedValue({ status: "discarded" });
    await openPage();
    await choose(fr.rendering.enriched);
    await screen.findByText(fr.rendering.fallback);

    await choose(fr.rendering.faithful);
    await choose(fr.rendering.enriched);
    expect(await screen.findByText(fr.rendering.fallback)).toBeTruthy();
    await act(async () => {});
    expect(render).toHaveBeenCalledTimes(1);
  });

  test("a stored rendering that cannot be read keeps the faithful text and calls nothing", async () => {
    read.mockRejectedValue(new Error("down"));
    await openPage();
    await choose(fr.rendering.enriched);

    expect(await screen.findByText(fr.rendering.fallback)).toBeTruthy();
    expect(render).not.toHaveBeenCalled();
  });

  test("an empty rendering is the neutral sentence too", async () => {
    render.mockResolvedValue({ status: "ready", text: "  \n " });
    await openPage();
    await choose(fr.rendering.enriched);

    expect(await screen.findByText(fr.rendering.fallback)).toBeTruthy();
  });
});

describe("when to ask [4]", () => {
  test("waits for the words of the page to be placed, so a text that is still changing is not rendered", async () => {
    await openPage();
    jest.mocked(pageService.words).mockResolvedValue({ words: [], corrections: [], gaps: [] });
    await choose(fr.rendering.enriched);
    await act(async () => {});
    expect(render).not.toHaveBeenCalled();

    jest.mocked(pageService.words).mockResolvedValue({ words: regexWordsOf(RAW), corrections: [], gaps: [] });
    await screen.findByText("•");
    expect(render).toHaveBeenCalledTimes(1);
  });

  test("goes back to the faithful text and asks nothing when the page type is switched", async () => {
    await openPage();
    await showEnriched();
    await fireEvent(screen.getByLabelText(fr.document.mathPage), "valueChange", true);

    await waitFor(() => expect(screen.queryByText("•")).toBeNull());
    await act(async () => {});
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("a correction [4]", () => {
  test("makes no call until the rendering is opened again, then one", async () => {
    await openPage();
    await showEnriched();
    expect(render).toHaveBeenCalledTimes(1);

    await choose(fr.rendering.faithful);
    await fireEvent.press(await screen.findByText("bornée"));
    await fireEvent.changeText(await screen.findByLabelText(fr.document.wordField), "bornés");
    await fireEvent.press(screen.getByText(fr.common.done));
    await waitFor(() => expect(words.written).toHaveLength(1));
    await screen.findByText(/bornés/u);
    expect(render).toHaveBeenCalledTimes(1);

    stored = { text: RENDERED, basedOn: renderingFingerprint(RAW) };
    render.mockResolvedValue({ status: "ready", text: RENDERED.replace("bornée", "bornés") });
    await showEnriched();
    await waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("bornés")).toBeTruthy();
  });
});

describe("what the rendering may show [5]", () => {
  test("shows the marks that are not accepted as the text they are", async () => {
    const hostile = "<script>alert(1)</script> et [lien](https://exemple.test) et ![image](https://exemple.test/a.png) et `code`";
    render.mockResolvedValue({ status: "ready", text: `# Titre\n\n${hostile}\n\n> citation\n\n| a | b |` });
    await openPage();
    await choose(fr.rendering.enriched);

    expect(await screen.findByText(hostile)).toBeTruthy();
    expect(screen.getByText("> citation")).toBeTruthy();
    expect(screen.getByText("| a | b |")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("image")).toBeNull();
  });

  test("draws the formulas of a page of math and keeps them in the text", async () => {
    pages.change("page-1", { pageType: "math", text: "Aire\n$a^2$" });
    render.mockResolvedValue({ status: "ready", text: "# Aire\n\nSoit $a^2$ le carré." });
    await openPage("Aire");
    await choose(fr.rendering.enriched);

    expect(await screen.findByText(/le carré/u)).toBeTruthy();
    await waitFor(() => expect(screen.queryAllByTestId("formula").length + screen.queryAllByText("$a^2$").length).toBeGreaterThan(0));
  });
});

describe("the strings [8]", () => {
  test("show in English too", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    render.mockResolvedValue({ status: "discarded" });
    await openPage();

    expect(selected(en.rendering.faithful)).toBe(true);
    await choose(en.rendering.enriched);
    expect(await screen.findByText(en.rendering.fallback)).toBeTruthy();
    expect(screen.getByLabelText(en.rendering.switchLabel)).toBeTruthy();
  });

  test("have a French and an English text for every sentence of the switch", () => {
    expect(Object.keys(fr.rendering).sort()).toEqual(Object.keys(en.rendering).sort());
    for (const key of Object.keys(fr.rendering) as (keyof typeof fr.rendering)[]) {
      expect(fr.rendering[key]).not.toBe("");
      expect(en.rendering[key]).not.toBe("");
    }
  });
});
