import { useLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { ActionSheetIOS, Alert, StyleSheet, type AlertButton } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import { notebookService } from "@/notebooks/service";
import { pageService } from "@/pages/service";
import { closeMenu } from "@/lib/action-menu";
import { colors } from "@/theme";
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
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));

const fr = strings.fr;
const en = strings.en;

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null };

const histoire = { id: "hist", name: "Histoire" };
const sciences = { id: "sci", name: "Sciences" };
const moyenAge = { id: "ch-moyen", notebookId: "hist", name: "Moyen Âge" };
const revolution = { id: "ch-rev", notebookId: "hist", name: "Révolution" };
const cellules = { id: "ch-cell", notebookId: "sci", name: "Cellules" };

const at = (day: number) => localMoment(8, day, 10, 0);

function titled(id: string, title: string, number: number, overrides: Partial<Parameters<typeof page>[0]> = {}) {
  return page({ id, notebookId: histoire.id, text: title, number, capturedAt: at(number + 10), uploadedAt: at(number + 10), ...overrides });
}

const carolingiens = titled("p1", "Les Carolingiens", 1, { chapterId: moyenAge.id });
const capetiens = titled("p2", "Les Capétiens", 2, { chapterId: moyenAge.id });
const introduction = titled("p3", "Introduction", 3);
const conclusion = titled("p4", "Conclusion", 4);
const mitose = titled("p5", "Mitose", 1, { notebookId: sciences.id });

let library: ReturnType<typeof installFakeLibrary>;
let sheet: jest.SpyInstance;
let alert: jest.SpyInstance;

function install(chapters = [moyenAge, revolution, cellules], pages = [carolingiens, capetiens, introduction, conclusion, mitose]) {
  library = installFakeLibrary({ notebooks: [histoire, sciences], chapters, pages });
}

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: false });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(histoire.id);
  jest.mocked(captureService.send).mockReset().mockResolvedValue({ status: "sent", pageId: "page-9" });
  jest.mocked(captureService.preparePhoto).mockReset().mockResolvedValue("file:///cache/prepared-0.jpg");
  jest.mocked(captureService.discardPhoto).mockReset();
  installPermission(granted);
  install();
  sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => undefined);
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => closeMenu());
  sheet.mockRestore();
  alert.mockRestore();
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

function lastAlert(): { title: string; body: string | undefined; buttons: AlertButton[] } {
  const [title, body, buttons] = alert.mock.calls[alert.mock.calls.length - 1] as [string, string | undefined, AlertButton[]];
  return { title, body, buttons };
}

async function confirmDestructive(): Promise<void> {
  const destructive = lastAlert().buttons.find((button) => button.style === "destructive");
  expect(destructive).toBeDefined();
  await act(async () => {
    destructive?.onPress?.();
  });
}

describe("the screen of a notebook with chapters", () => {
  test("shows its chapters first with their page counts, then the pages outside any chapter, newest first", async () => {
    await openApp(`/notebook/${histoire.id}`);

    expect(await screen.findByText(fr.notebook.chaptersHeading)).toBeTruthy();
    expect(screen.getByText(moyenAge.name)).toBeTruthy();
    expect(screen.getByText(revolution.name)).toBeTruthy();
    expect(screen.getByText(fr.notebook.pageCount(2))).toBeTruthy();
    expect(screen.getByText(fr.notebook.pageCount(0))).toBeTruthy();
    expect(screen.getByText(fr.notebook.pagesHeading)).toBeTruthy();
    expect(screen.queryByText("Les Carolingiens")).toBeNull();
    expect(screen.queryByText("Mitose")).toBeNull();

    const all = screen.getAllByText(/^(Introduction|Conclusion|Moyen Âge|Révolution)$/).map((node) => node.props.children);
    expect(all).toEqual(["Moyen Âge", "Révolution", "Conclusion", "Introduction"]);
  });

  test("counts every page of the notebook, those in chapters too", async () => {
    await openApp(`/notebook/${histoire.id}`);
    expect(await screen.findByText(fr.notebook.pageCount(4))).toBeTruthy();
  });

  test("keeps the look of a notebook with no chapter: no heading", async () => {
    install([], [introduction, conclusion]);
    await openApp(`/notebook/${histoire.id}`);

    expect(await screen.findByText("Conclusion")).toBeTruthy();
    expect(screen.queryByText(fr.notebook.chaptersHeading)).toBeNull();
    expect(screen.queryByText(fr.notebook.pagesHeading)).toBeNull();
  });

  test("opens a chapter", async () => {
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await fireEvent.press(await screen.findByText(moyenAge.name));
    expect(pathname()).toBe(`/chapter/${moyenAge.id}`);
  });

  test("shows the chapters of a notebook whose pages are all in chapters", async () => {
    install([moyenAge], [carolingiens, capetiens]);
    await openApp(`/notebook/${histoire.id}`);

    expect(await screen.findByText(moyenAge.name)).toBeTruthy();
    expect(screen.queryByText(fr.notebook.emptyTitle)).toBeNull();
    expect(screen.queryByText(fr.notebook.pagesHeading)).toBeNull();
  });
});

describe("when the chapters cannot be loaded", () => {
  test("the notebook screen says so and offers to try again, instead of hiding the pages in chapters", async () => {
    jest.mocked(notebookService.chapters).mockRejectedValueOnce(new Error("offline"));
    await openApp(`/notebook/${histoire.id}`);

    await fireEvent.press(await screen.findByText(fr.common.retry));
    expect(await screen.findByText(moyenAge.name)).toBeTruthy();
  });

  test("the rename sheet of something that is gone still has a way out", async () => {
    const pathname = await openApp("/rename?kind=chapter&id=missing");
    await fireEvent.press(await screen.findByText(fr.common.cancel));
    await waitFor(() => expect(pathname()).not.toBe("/rename"));
  });
});

describe("creating a chapter", () => {
  test("is offered by the menu of the notebook, creates the chapter and opens it [11]", async () => {
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);

    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.newChapter);
    expect(pathname()).toBe("/new-chapter");
    await fireEvent.changeText(screen.getByLabelText(fr.newChapter.nameLabel), "  Antiquité ");
    await fireEvent.press(screen.getByText(fr.newChapter.create));

    await waitFor(() => expect(pathname()).toMatch(/^\/chapter\/chapter-new-/));
    expect(notebookService.createChapter).toHaveBeenCalledWith(histoire.id, "  Antiquité ");
    expect(await screen.findByText("Antiquité")).toBeTruthy();
    expect(screen.getByText(fr.chapter.emptyTitle)).toBeTruthy();
  });

  test("a name already used in the notebook is refused with the same message as for a notebook", async () => {
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);
    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.newChapter);

    await fireEvent.changeText(screen.getByLabelText(fr.newChapter.nameLabel), moyenAge.name);
    await fireEvent.press(screen.getByText(fr.newChapter.create));

    expect(await screen.findByText(fr.newChapter.duplicate(moyenAge.name))).toBeTruthy();
    expect(pathname()).toBe("/new-chapter");
  });

  test("a blank name sends nothing; a failure is told", async () => {
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);
    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.newChapter);

    await fireEvent.changeText(screen.getByLabelText(fr.newChapter.nameLabel), "   ");
    await fireEvent.press(screen.getByText(fr.newChapter.create));
    expect(notebookService.createChapter).not.toHaveBeenCalled();

    jest.mocked(notebookService.createChapter).mockResolvedValueOnce({ status: "failed" });
    await fireEvent.changeText(screen.getByLabelText(fr.newChapter.nameLabel), "Antiquité");
    await fireEvent.press(screen.getByText(fr.newChapter.create));
    expect(await screen.findByText(fr.newChapter.failed)).toBeTruthy();
  });
});

describe("renaming", () => {
  test("a notebook: the field starts with its name, the new name shows on the screen [12]", async () => {
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);

    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.rename);
    expect(pathname()).toBe("/rename");
    const field = await screen.findByLabelText(fr.rename.notebookLabel);
    expect(field.props.value).toBe("Histoire");
    await fireEvent.changeText(field, "Histoire de France");
    await fireEvent.press(screen.getByText(fr.rename.save));

    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
    expect(notebookService.rename).toHaveBeenCalledWith(histoire.id, "Histoire de France");
    expect(await screen.findByText("Histoire de France")).toBeTruthy();
  });

  test("a notebook refuses a taken name, with the message of the creation", async () => {
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);
    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.rename);

    await fireEvent.changeText(await screen.findByLabelText(fr.rename.notebookLabel), sciences.name);
    await fireEvent.press(screen.getByText(fr.rename.save));

    expect(await screen.findByText(fr.newNotebook.duplicate(sciences.name))).toBeTruthy();
  });

  test("keeping the same name closes the sheet without any call", async () => {
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);
    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.rename);

    await fireEvent.press(await screen.findByText(fr.rename.save));

    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
    expect(notebookService.rename).not.toHaveBeenCalled();
  });

  test("a failure of the server is told", async () => {
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);
    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.rename);

    jest.mocked(notebookService.rename).mockResolvedValueOnce({ status: "failed" });
    await fireEvent.changeText(await screen.findByLabelText(fr.rename.notebookLabel), "Autre");
    await fireEvent.press(screen.getByText(fr.rename.save));

    expect(await screen.findByText(fr.rename.failed)).toBeTruthy();
  });

  test("a chapter, from its own screen [11]", async () => {
    const pathname = await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText(moyenAge.name);

    await chooseFromMenu(fr.chapter.menuLabel, fr.chapter.rename);
    const field = await screen.findByLabelText(fr.rename.chapterLabel);
    expect(field.props.value).toBe(moyenAge.name);
    await fireEvent.changeText(field, "Moyen-Âge");
    await fireEvent.press(screen.getByText(fr.rename.save));

    await waitFor(() => expect(pathname()).toBe(`/chapter/${moyenAge.id}`));
    expect(notebookService.renameChapter).toHaveBeenCalledWith(moyenAge.id, "Moyen-Âge");
    expect(await screen.findByText("Moyen-Âge")).toBeTruthy();
  });

  test("a chapter refuses a name used by another chapter of its notebook", async () => {
    await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText(moyenAge.name);
    await chooseFromMenu(fr.chapter.menuLabel, fr.chapter.rename);

    await fireEvent.changeText(await screen.findByLabelText(fr.rename.chapterLabel), revolution.name);
    await fireEvent.press(screen.getByText(fr.rename.save));

    expect(await screen.findByText(fr.newChapter.duplicate(revolution.name))).toBeTruthy();
  });
});

describe("the screen of a chapter", () => {
  test("shows its pages, newest first, and none of the others", async () => {
    await openApp(`/chapter/${moyenAge.id}`);

    expect(await screen.findByText("Les Capétiens")).toBeTruthy();
    expect(screen.getByText("Les Carolingiens")).toBeTruthy();
    expect(screen.queryByText("Introduction")).toBeNull();
    expect(screen.getByText(fr.notebook.pageCount(2))).toBeTruthy();
    const titles = screen.getAllByText(/^Les /).map((node) => node.props.children);
    expect(titles).toEqual(["Les Capétiens", "Les Carolingiens"]);
  });

  test("names the notebook in its back link, which goes back to the notebook", async () => {
    const pathname = await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText("Les Capétiens");

    await fireEvent.press(await screen.findByLabelText(fr.common.back));
    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
  });

  test("says when it is empty", async () => {
    await openApp(`/chapter/${revolution.id}`);
    expect(await screen.findByText(fr.chapter.emptyTitle)).toBeTruthy();
    expect(screen.getByText(fr.chapter.emptyBody)).toBeTruthy();
  });

  test("shows the page of a chapter opened by the library as well", async () => {
    const pathname = await openApp(`/chapter/${moyenAge.id}`);
    await fireEvent.press(await screen.findByText("Les Capétiens"));
    expect(pathname()).toBe("/page/p2");
  });

  test("goes back to the library when the chapter is gone", async () => {
    const pathname = await openApp("/chapter/missing");
    await waitFor(() => expect(pathname()).toBe("/"));
  });

  test("Scan opens the camera in this notebook and this chapter, and the page is filed in the chapter [11]", async () => {
    const pathname = await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText("Les Capétiens");

    await fireEvent.press(await screen.findByText(fr.common.scan));
    await waitFor(() => expect(pathname()).toBe("/capture"));
    await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));
    await fireEvent.press(await screen.findByText(fr.capture.read));

    await waitFor(() => expect(captureService.send).toHaveBeenCalled());
    expect(jest.mocked(captureService.send).mock.calls[0][0]).toEqual({
      notebookId: histoire.id,
      chapterId: moyenAge.id,
      photoUri: "file:///cache/prepared-0.jpg",
      pageId: null,
    });
  });

  test("Scan from a notebook files the page in no chapter", async () => {
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);

    await fireEvent.press(await screen.findByText(fr.common.scan));
    await waitFor(() => expect(pathname()).toBe("/capture"));
    await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));
    await fireEvent.press(await screen.findByText(fr.capture.read));

    await waitFor(() => expect(captureService.send).toHaveBeenCalled());
    expect(jest.mocked(captureService.send).mock.calls[0][0]).toEqual({
      notebookId: histoire.id,
      photoUri: "file:///cache/prepared-0.jpg",
      pageId: null,
    });
  });
});

describe("deleting a chapter", () => {
  test("asks first, in danger; its pages come back outside any chapter [11]", async () => {
    const pathname = await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText("Les Capétiens");

    await chooseFromMenu(fr.chapter.menuLabel, fr.chapter.delete);
    expect(lastAlert().title).toBe(fr.chapter.deleteTitle);
    expect(lastAlert().body).toBe(fr.chapter.deleteBody);
    expect(lastAlert().buttons.map((button) => button.text)).toEqual([fr.common.cancel, fr.chapter.delete]);
    expect(notebookService.removeChapter).not.toHaveBeenCalled();

    await confirmDestructive();

    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
    expect(notebookService.removeChapter).toHaveBeenCalledWith(moyenAge.id);
    expect(await screen.findByText("Les Capétiens")).toBeTruthy();
    expect(screen.getByText("Introduction")).toBeTruthy();
    expect(screen.queryByText(moyenAge.name)).toBeNull();
  });

  test("cancelling deletes nothing", async () => {
    await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText("Les Capétiens");
    await chooseFromMenu(fr.chapter.menuLabel, fr.chapter.delete);

    expect(lastAlert().buttons.find((button) => button.style === "cancel")).toBeDefined();
    expect(notebookService.removeChapter).not.toHaveBeenCalled();
  });

  test("a failure is told and the chapter stays", async () => {
    const pathname = await openApp(`/chapter/${moyenAge.id}`);
    await screen.findByText("Les Capétiens");
    await chooseFromMenu(fr.chapter.menuLabel, fr.chapter.delete);

    jest.mocked(notebookService.removeChapter).mockResolvedValueOnce({ status: "network" });
    await confirmDestructive();

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    expect(lastAlert().title).toBe(fr.chapter.deleteFailed);
    expect(pathname()).toBe(`/chapter/${moyenAge.id}`);
  });
});

describe("deleting a notebook", () => {
  test("asks with the number of pages that go, in danger [12]", async () => {
    await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);

    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.delete);

    expect(lastAlert().title).toBe("Supprimer le carnet et ses 4 pages ?");
    expect(lastAlert().body).toBe(fr.notebook.deleteBody);
    expect(lastAlert().buttons.map((button) => button.style)).toEqual(["cancel", "destructive"]);
    expect(notebookService.remove).not.toHaveBeenCalled();
  });

  test("deletes the notebook and comes back to the library", async () => {
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);
    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.delete);

    await confirmDestructive();

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(notebookService.remove).toHaveBeenCalledWith(histoire.id);
    expect(await screen.findByText(sciences.name)).toBeTruthy();
    expect(screen.queryByText(histoire.name)).toBeNull();
  });

  test("a notebook with a page being read is refused and told", async () => {
    install([moyenAge], [titled("p1", "Les Carolingiens", 1, { status: "processing", text: null }), introduction]);
    const pathname = await openApp(`/notebook/${histoire.id}`);
    await screen.findByText(moyenAge.name);
    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.delete);

    await confirmDestructive();

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    expect(lastAlert().title).toBe(fr.notebook.deleteBusy);
    expect(pathname()).toBe(`/notebook/${histoire.id}`);
  });

  test("the last notebook deleted brings the first launch screen back", async () => {
    library = installFakeLibrary({ notebooks: [sciences], chapters: [], pages: [mitose] });
    const pathname = await openApp(`/notebook/${sciences.id}`);
    await screen.findByText("Mitose");
    await chooseFromMenu(fr.notebook.menuLabel, fr.notebook.delete);
    expect(lastAlert().title).toBe(fr.notebook.deleteTitle(1));

    await confirmDestructive();

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(await screen.findByText(fr.library.firstLaunch.title)).toBeTruthy();
  });
});

describe("the sheet of a menu", () => {
  test("closes by itself when the screen changes", async () => {
    await openApp(`/notebook/${histoire.id}`);
    await fireEvent.press(await screen.findByLabelText(fr.notebook.menuLabel));
    expect(screen.getAllByTestId(/^action-sheet-option-/).length).toBeGreaterThan(0);

    await act(async () => router.push(`/chapter/${moyenAge.id}`));

    await waitFor(() => expect(screen.queryAllByTestId(/^action-sheet-option-/)).toHaveLength(0));
  });
});

describe("the menu of a page", () => {
  test("offers to move and to delete a page that is read, next to its photo", async () => {
    await openApp("/page/p2");
    await screen.findByText("Les Capétiens");

    await fireEvent.press(await screen.findByLabelText(fr.pageMenu.label));
    const labels = (await screen.findAllByRole("button")).map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(expect.arrayContaining([fr.pageMenu.move, fr.pageMenu.delete, fr.common.cancel]));
    const options = screen.getAllByTestId(/^action-sheet-option-/).map((node) => node.props.accessibilityLabel);
    expect(options).toEqual([fr.pageMenu.move, fr.pageMenu.delete]);
    expect(StyleSheet.flatten(screen.getByTestId("action-sheet-label-1").props.style).color).toBe(colors.danger);
    expect(sheet).not.toHaveBeenCalled();
    expect(screen.getByLabelText(fr.document.openPhoto, { includeHiddenElements: true })).toBeTruthy();
  });

  test("moves the page to a chapter of another notebook [12]", async () => {
    const pathname = await openApp("/page/p3");
    await screen.findByText("Introduction");

    await chooseFromMenu(fr.pageMenu.label, fr.pageMenu.move);
    expect(pathname()).toBe("/page/p3/move");
    expect(await screen.findByText(fr.move.title)).toBeTruthy();
    expect(screen.getByText(histoire.name)).toBeTruthy();
    expect(screen.getByText(sciences.name)).toBeTruthy();
    expect(screen.getByText(moyenAge.name)).toBeTruthy();
    expect(screen.getByText(cellules.name)).toBeTruthy();

    await fireEvent.press(screen.getByText(cellules.name));

    await waitFor(() => expect(pathname()).toBe("/page/p3"));
    expect(pageService.move).toHaveBeenCalledWith("p3", sciences.id, cellules.id);
    await waitFor(() => expect(screen.getByLabelText(fr.common.back)).toHaveTextContent(sciences.name, { exact: false }));
  });

  test("moves the page out of its chapter by choosing the notebook", async () => {
    await openApp("/page/p1/move");
    await screen.findByText(fr.move.title);

    await fireEvent.press(screen.getByText(histoire.name));

    await waitFor(() => expect(pageService.move).toHaveBeenCalledWith("p1", histoire.id, null));
  });

  test("marks where the page is now, and choosing it moves nothing", async () => {
    const pathname = await openApp("/page/p1/move");
    await screen.findByText(fr.move.title);

    expect(screen.getByRole("button", { name: new RegExp(moyenAge.name), selected: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: histoire.name, selected: false })).toBeTruthy();
    await fireEvent.press(screen.getByText(moyenAge.name));

    await waitFor(() => expect(pathname()).not.toBe("/page/p1/move"));
    expect(pageService.move).not.toHaveBeenCalled();
  });

  test("a page being read is refused and told in the sheet", async () => {
    library.pages.change("p3", { status: "processing" });
    await openApp("/page/p3/move");
    await screen.findByText(fr.move.title);

    await fireEvent.press(screen.getByText(sciences.name));

    expect(await screen.findByText(fr.move.busy)).toBeTruthy();
    expect(pageService.move).toHaveBeenCalledTimes(1);
  });

  test("any other failure is told in the sheet, and the page stays where it was", async () => {
    const pathname = await openApp("/page/p3/move");
    await screen.findByText(fr.move.title);

    jest.mocked(pageService.move).mockResolvedValueOnce({ status: "network" });
    await fireEvent.press(screen.getByText(sciences.name));

    expect(await screen.findByText(fr.move.failed)).toBeTruthy();
    expect(pathname()).toBe("/page/p3/move");
  });

  test("deleting asks first, in danger, then goes back to the notebook with the page gone [12]", async () => {
    const pathname = await openApp("/page/p3");
    await screen.findByText("Introduction");

    await chooseFromMenu(fr.pageMenu.label, fr.pageMenu.delete);
    expect(lastAlert().title).toBe(fr.pageMenu.deleteTitle);
    expect(lastAlert().body).toBe(fr.pageMenu.deleteBody);
    expect(lastAlert().buttons.map((button) => button.style)).toEqual(["cancel", "destructive"]);
    expect(pageService.remove).not.toHaveBeenCalled();

    await confirmDestructive();

    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
    expect(pageService.remove).toHaveBeenCalledWith("p3");
    expect(await screen.findByText("Conclusion")).toBeTruthy();
    expect(screen.queryByText("Introduction")).toBeNull();
    expect(screen.getByText(fr.notebook.pageCount(3))).toBeTruthy();
  });

  test("a page that is gone already leaves the screen as a deletion", async () => {
    const pathname = await openApp("/page/p3");
    await screen.findByText("Introduction");
    await chooseFromMenu(fr.pageMenu.label, fr.pageMenu.delete);

    jest.mocked(pageService.remove).mockResolvedValueOnce({ status: "missing" });
    await confirmDestructive();

    await waitFor(() => expect(pathname()).toBe(`/notebook/${histoire.id}`));
  });

  test("a page being read, or a failure, is told and the page stays", async () => {
    const pathname = await openApp("/page/p3");
    await screen.findByText("Introduction");

    await chooseFromMenu(fr.pageMenu.label, fr.pageMenu.delete);
    jest.mocked(pageService.remove).mockResolvedValueOnce({ status: "busy" });
    await confirmDestructive();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    expect(lastAlert().title).toBe(fr.pageMenu.deleteBusy);

    await chooseFromMenu(fr.pageMenu.label, fr.pageMenu.delete);
    jest.mocked(pageService.remove).mockResolvedValueOnce({ status: "error" });
    await confirmDestructive();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(4));
    expect(lastAlert().title).toBe(fr.pageMenu.deleteFailed);
    expect(pathname()).toBe("/page/p3");
  });

  test("Scan the next page, from a page in a chapter, files the next one in the same chapter", async () => {
    library.pages.change("p2", { status: "queued" });
    const pathname = await openApp("/page/p2");
    await fireEvent.press(await screen.findByText(fr.reading.scanNext));

    await waitFor(() => expect(pathname()).toBe("/capture"));
    await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));
    await fireEvent.press(await screen.findByText(fr.capture.read));
    await waitFor(() => expect(captureService.send).toHaveBeenCalled());
    expect(jest.mocked(captureService.send).mock.calls[0][0]).toEqual(expect.objectContaining({ notebookId: histoire.id, chapterId: moyenAge.id }));
  });
});

describe("in English", () => {
  beforeEach(() => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  });

  test("the menus, the questions and the sheets speak English [10] [12]", async () => {
    await openApp(`/notebook/${histoire.id}`);
    expect(await screen.findByText(en.notebook.chaptersHeading)).toBeTruthy();
    expect(screen.getByText(en.notebook.pagesHeading)).toBeTruthy();

    await chooseFromMenu(en.notebook.menuLabel, en.notebook.delete);
    expect(lastAlert().title).toBe("Delete the notebook and its 4 pages?");
    expect(lastAlert().body).toBe(en.notebook.deleteBody);
    expect(lastAlert().buttons.map((button) => button.text)).toEqual([en.common.cancel, en.notebook.delete]);
  });

  test("the sheet of a move speaks English", async () => {
    await openApp("/page/p3/move");
    expect(await screen.findByText(en.move.title)).toBeTruthy();
    expect(screen.getByText(en.move.hint)).toBeTruthy();
  });
});
