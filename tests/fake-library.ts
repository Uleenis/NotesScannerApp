import type { ChapterSummary } from "@/notebooks/chapters";
import type { NotebookSummary } from "@/notebooks/notebooks";
import { notebookService } from "@/notebooks/service";
import type { NumberedPage } from "@/pages/pages";
import { pageService } from "@/pages/service";
import { installFakePages } from "./fake-page-service";

export type Library = {
  notebooks: Omit<NotebookSummary, "pageCount">[];
  chapters: Omit<ChapterSummary, "pageCount">[];
  pages: NumberedPage[];
};

export function installFakeLibrary(initial: Library) {
  const state = {
    notebooks: initial.notebooks.map((notebook) => ({ ...notebook })),
    chapters: initial.chapters.map((chapter) => ({ ...chapter })),
  };
  const pages = installFakePages(initial.pages);
  const store = pages.store;

  const notebookView = (notebook: Omit<NotebookSummary, "pageCount">): NotebookSummary => ({
    ...notebook,
    pageCount: store.filter((page) => page.notebookId === notebook.id).length,
  });
  const chapterView = (chapter: Omit<ChapterSummary, "pageCount">): ChapterSummary => ({
    ...chapter,
    pageCount: store.filter((page) => page.chapterId === chapter.id).length,
  });
  const reading = (ids: string[]) => store.some((page) => ids.includes(page.id) && page.status === "processing");

  jest.mocked(notebookService.list).mockReset().mockImplementation(async () => state.notebooks.map(notebookView));
  jest
    .mocked(notebookService.get)
    .mockReset()
    .mockImplementation(async (id) => {
      const found = state.notebooks.find((notebook) => notebook.id === id);
      return found === undefined ? null : notebookView(found);
    });
  jest.mocked(notebookService.create).mockReset();
  jest
    .mocked(notebookService.rename)
    .mockReset()
    .mockImplementation(async (id, rawName) => {
      const name = rawName.trim();
      if (name === "") {
        return { status: "empty" };
      }
      if (state.notebooks.some((notebook) => notebook.id !== id && notebook.name === name)) {
        return { status: "duplicate", name };
      }
      const found = state.notebooks.find((notebook) => notebook.id === id);
      if (found === undefined) {
        return { status: "failed" };
      }
      found.name = name;
      return { status: "renamed", notebook: notebookView(found) };
    });
  jest
    .mocked(notebookService.remove)
    .mockReset()
    .mockImplementation(async (id) => {
      if (!state.notebooks.some((notebook) => notebook.id === id)) {
        return { status: "missing" };
      }
      if (reading(store.filter((page) => page.notebookId === id).map((page) => page.id))) {
        return { status: "busy" };
      }
      state.notebooks = state.notebooks.filter((notebook) => notebook.id !== id);
      state.chapters = state.chapters.filter((chapter) => chapter.notebookId !== id);
      for (let index = store.length - 1; index >= 0; index -= 1) {
        if (store[index].notebookId === id) {
          store.splice(index, 1);
        }
      }
      return { status: "deleted" };
    });
  jest.mocked(notebookService.chapters).mockReset().mockImplementation(async () => state.chapters.map(chapterView));
  jest
    .mocked(notebookService.createChapter)
    .mockReset()
    .mockImplementation(async (notebookId, rawName) => {
      const name = rawName.trim();
      if (name === "") {
        return { status: "empty" };
      }
      if (state.chapters.some((chapter) => chapter.notebookId === notebookId && chapter.name === name)) {
        return { status: "duplicate", name };
      }
      const chapter = { id: `chapter-new-${state.chapters.length + 1}`, notebookId, name };
      state.chapters.push(chapter);
      return { status: "created", chapter: chapterView(chapter) };
    });
  jest
    .mocked(notebookService.renameChapter)
    .mockReset()
    .mockImplementation(async (id, rawName) => {
      const name = rawName.trim();
      const found = state.chapters.find((chapter) => chapter.id === id);
      if (name === "") {
        return { status: "empty" };
      }
      if (found === undefined) {
        return { status: "failed" };
      }
      if (state.chapters.some((chapter) => chapter.id !== id && chapter.notebookId === found.notebookId && chapter.name === name)) {
        return { status: "duplicate", name };
      }
      found.name = name;
      return { status: "renamed", chapter: chapterView(found) };
    });
  jest
    .mocked(notebookService.removeChapter)
    .mockReset()
    .mockImplementation(async (id) => {
      if (!state.chapters.some((chapter) => chapter.id === id)) {
        return { status: "missing" };
      }
      state.chapters = state.chapters.filter((chapter) => chapter.id !== id);
      store.forEach((page, index) => {
        if (page.chapterId === id) {
          store[index] = { ...page, chapterId: null };
        }
      });
      return { status: "deleted" };
    });

  jest
    .mocked(pageService.move)
    .mockReset()
    .mockImplementation(async (pageId, notebookId, chapterId) => {
      const index = store.findIndex((page) => page.id === pageId);
      if (index === -1) {
        return { status: "missing" };
      }
      if (store[index].status === "processing") {
        return { status: "busy" };
      }
      store[index] = { ...store[index], notebookId, chapterId };
      return { status: "moved" };
    });
  jest
    .mocked(pageService.remove)
    .mockReset()
    .mockImplementation(async (pageId) => {
      const index = store.findIndex((page) => page.id === pageId);
      if (index === -1) {
        return { status: "missing" };
      }
      if (store[index].status === "processing") {
        return { status: "busy" };
      }
      store.splice(index, 1);
      return { status: "deleted" };
    });

  return { state, pages };
}
