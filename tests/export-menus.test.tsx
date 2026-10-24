import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert, type AlertButton } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { ExportSource } from "@/export/document";
import { exportDeps } from "@/export/service";
import { strings } from "@/i18n";
import { closeMenu } from "@/lib/action-menu";
import { granted, installPermission } from "./fake-camera";
import { installFakeLibrary } from "./fake-library";
import { localMoment, page } from "./fake-page-service";
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
jest.mock("@/notebooks/service", () => ({ notebookService: require("./library-mocks").NOTEBOOK_SERVICE_MOCK }));
jest.mock("@/pages/service", () => ({ pageService: require("./library-mocks").PAGE_SERVICE_MOCK }));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(async () => null), latestNotebookId: jest.fn(async () => null), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));
jest.mock("@/export/service", () => ({
  exportDeps: { sources: jest.fn(), draw: jest.fn(), save: jest.fn(), share: jest.fn() },
}));

const fr = strings.fr;
const en = strings.en;

const histoire = { id: "hist", name: "Histoire" };
const sciences = { id: "sci", name: "Sciences" };
const moyenAge = { id: "ch-moyen", notebookId: "hist", name: "Moyen Âge" };
const at = (day: number) => localMoment(8, day, 10, 0);

function titled(id: string, text: string, number: number, overrides: Partial<Parameters<typeof page>[0]> = {}) {
  return page({ id, notebookId: histoire.id, text, number, capturedAt: at(number + 10), uploadedAt: at(number + 10), ...overrides });
}

const carolingiens = titled("p1", "Les Carolingiens\nCharlemagne", 1, { chapterId: moyenAge.id });
const capetiens = titled("p2", "Les Capétiens", 2, { chapterId: moyenAge.id });
const introduction = titled("p3", "Introduction", 3);
const mitose = titled("p5", "Mitose", 1, { notebookId: sciences.id });
const pending = titled("p6", "Pas lu", 5, { status: "processing" });

let alert: jest.SpyInstance;
const saved: { format: string; name: string; content: string }[] = [];
const discarded: string[] = [];

function install(pages = [carolingiens, capetiens, introduction, mitose]) {
  installFakeLibrary({ notebooks: [histoire, sciences], chapters: [moyenAge], pages });
}

beforeEach(() => {
  saved.length = 0;
  discarded.length = 0;
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: false });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  installPermission(granted);
  install();
  jest.mocked(exportDeps.sources).mockReset().mockImplementation(async (ids: string[]) => new Map<string, ExportSource>(ids.map((id) => [id, { second: null, edited: false }])));
  jest.mocked(exportDeps.draw).mockReset().mockResolvedValue(null);
  jest
    .mocked(exportDeps.save)
    .mockReset()
    .mockImplementation(async (file) => {
      saved.push(file);
      return { uri: `file:///cache/${file.name}`, discard: () => void discarded.push(file.name) };
    });
  jest.mocked(exportDeps.share).mockReset().mockResolvedValue(true);
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => closeMenu());
  alert.mockRestore();
});

async function openApp(initialUrl: string): Promise<void> {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
}

async function chooseFromMenu(menuLabel: string | null, item: string): Promise<void> {
  if (menuLabel !== null) {
    await fireEvent.press(await screen.findByLabelText(menuLabel));
  }
  const option = (await screen.findAllByTestId(/^action-sheet-option-/)).find((node) => node.props.accessibilityLabel === item);
  expect(option).toBeDefined();
  await fireEvent.press(option!);
}

function lastAlert(): { title: string; body: string | undefined; buttons: AlertButton[] } {
  const [title, body, buttons] = alert.mock.calls[alert.mock.calls.length - 1] as [string, string | undefined, AlertButton[]];
  return { title, body, buttons };
}

async function exportAs(menuLabel: string, format: string): Promise<void> {
  await chooseFromMenu(menuLabel, fr.export.label);
  await chooseFromMenu(null, format);
}

describe("the export menus", () => {
  test("the menu of a page offers Export first, then a choice of PDF or Markdown", async () => {
    await openApp("/page/p2");
    await screen.findByText("Les Capétiens");

    await fireEvent.press(await screen.findByLabelText(fr.pageMenu.label));
    expect(screen.getAllByTestId(/^action-sheet-option-/).map((node) => node.props.accessibilityLabel)).toEqual([fr.export.label, fr.pageMenu.move, fr.pageMenu.delete]);

    await chooseFromMenu(null, fr.export.label);
    await waitFor(() => expect(screen.getAllByTestId(/^action-sheet-option-/).map((node) => node.props.accessibilityLabel)).toEqual([fr.export.pdf, fr.export.markdown]));
  });

  test("the menu of a chapter offers Export first", async () => {
    await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText("Les Capétiens");
    await fireEvent.press(await screen.findByLabelText(fr.chapter.menuLabel));
    expect(screen.getAllByTestId(/^action-sheet-option-/)[0].props.accessibilityLabel).toBe(fr.export.label);
  });

  test("the menu of a notebook offers Export after Search", async () => {
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(histoire.name);
    await fireEvent.press(await screen.findByLabelText(fr.notebook.menuLabel));
    expect(screen.getAllByTestId(/^action-sheet-option-/).slice(0, 2).map((node) => node.props.accessibilityLabel)).toEqual([fr.search.open, fr.export.label]);
  });
});

describe("exporting", () => {
  test("shares the Markdown of a page, named after its title, and erases the file", async () => {
    await openApp("/page/p1");
    await screen.findByText("Les Carolingiens");

    await exportAs(fr.pageMenu.label, fr.export.markdown);

    await waitFor(() => expect(exportDeps.share).toHaveBeenCalled());
    expect(saved).toEqual([{ format: "markdown", name: "Les-Carolingiens", content: "# Les Carolingiens\n\nCharlemagne\n" }]);
    expect(exportDeps.share).toHaveBeenCalledWith("file:///cache/Les-Carolingiens", "markdown");
    await waitFor(() => expect(discarded).toEqual(["Les-Carolingiens"]));
    expect(alert).not.toHaveBeenCalled();
  });

  test("shares the PDF of a chapter with its pages in the order of the screen", async () => {
    await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText("Les Capétiens");

    await exportAs(fr.chapter.menuLabel, fr.export.pdf);

    await waitFor(() => expect(exportDeps.share).toHaveBeenCalled());
    expect(saved).toHaveLength(1);
    expect(saved[0].format).toBe("pdf");
    expect(saved[0].name).toBe("Moyen-Âge");
    const html = saved[0].content;
    expect(html.indexOf("Les Capétiens")).toBeGreaterThan(-1);
    expect(html.indexOf("Les Capétiens")).toBeLessThan(html.indexOf("Les Carolingiens"));
    expect(html).not.toContain("Introduction");
    expect(html).toContain('<html lang="fr">');
  });

  test("exports a notebook with its chapters and its other pages, and nothing of another notebook", async () => {
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(histoire.name);

    await exportAs(fr.notebook.menuLabel, fr.export.markdown);

    await waitFor(() => expect(exportDeps.share).toHaveBeenCalled());
    expect(saved[0].name).toBe("Histoire");
    expect(saved[0].content).toBe(
      `# Histoire\n\n## Moyen Âge\n\n### Les Capétiens\n\n### Les Carolingiens\n\nCharlemagne\n\n## ${fr.notebook.pagesHeading}\n\n### Introduction\n`,
    );
  });

  test("uses the language of the phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(histoire.name);

    await fireEvent.press(await screen.findByLabelText(en.notebook.menuLabel));
    await chooseFromMenu(null, en.export.label);
    await chooseFromMenu(null, en.export.markdown);

    await waitFor(() => expect(exportDeps.share).toHaveBeenCalled());
    expect(saved[0].content).toContain(`## ${en.notebook.pagesHeading}`);
  });

  test("says there is nothing to export when no page is read", async () => {
    install([pending]);
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(histoire.name);

    await exportAs(fr.notebook.menuLabel, fr.export.pdf);

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(lastAlert().title).toBe(fr.export.nothing);
    expect(exportDeps.save).not.toHaveBeenCalled();
  });

  test.each([
    ["the save fails", () => jest.mocked(exportDeps.save).mockRejectedValue(new Error("boom")), fr.export.failed],
    ["the phone cannot share", () => jest.mocked(exportDeps.share).mockResolvedValue(false), fr.export.unavailable],
  ])("says so when %s", async (_, arrange, message) => {
    arrange();
    await openApp("/page/p3");
    await screen.findByText("Introduction");

    await exportAs(fr.pageMenu.label, fr.export.markdown);

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(lastAlert().title).toBe(message);
  });

  test("shows the wait with a Cancel button, and shares nothing once cancelled", async () => {
    let release: (value: Map<string, ExportSource>) => void = () => undefined;
    jest.mocked(exportDeps.sources).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await openApp("/page/p3");
    await screen.findByText("Introduction");

    await exportAs(fr.pageMenu.label, fr.export.pdf);

    expect(await screen.findByText(fr.export.preparing)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(fr.common.cancel));
    await act(async () => release(new Map()));

    await waitFor(() => expect(screen.queryByText(fr.export.preparing)).toBeNull());
    expect(exportDeps.save).not.toHaveBeenCalled();
    expect(exportDeps.share).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  test("removes the wait when the export ends", async () => {
    await openApp("/page/p3");
    await screen.findByText("Introduction");
    await exportAs(fr.pageMenu.label, fr.export.markdown);
    await waitFor(() => expect(exportDeps.share).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(fr.export.preparing)).toBeNull());
  });
});
