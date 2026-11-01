import { getSupabase } from "@/lib/supabase";
import { throughMirror } from "@/offline/through";
import {
  createChapter,
  listChapters,
  renameChapter,
  type ChapterSummary,
  type CreateChapterResult,
  type RenameChapterResult,
} from "./chapters";
import {
  createNotebook,
  getNotebook,
  listNotebooks,
  renameNotebook,
  type CreateNotebookResult,
  type NotebookSummary,
  type RenameNotebookResult,
} from "./notebooks";
import { deleteChapter, deleteNotebook, type DeleteResult } from "./removal";

export type NotebookService = {
  list: () => Promise<NotebookSummary[]>;
  get: (id: string) => Promise<NotebookSummary | null>;
  create: (name: string) => Promise<CreateNotebookResult>;
  rename: (id: string, name: string) => Promise<RenameNotebookResult>;
  remove: (id: string) => Promise<DeleteResult>;
  chapters: () => Promise<ChapterSummary[]>;
  createChapter: (notebookId: string, name: string) => Promise<CreateChapterResult>;
  renameChapter: (id: string, name: string) => Promise<RenameChapterResult>;
  removeChapter: (id: string) => Promise<DeleteResult>;
};

export const notebookService: NotebookService = {
  list: () =>
    throughMirror(
      () => listNotebooks(getSupabase()),
      (mirror, notebooks) => mirror.notebooks(notebooks),
    ),
  get: (id) =>
    throughMirror(
      () => getNotebook(getSupabase(), id),
      (mirror, notebook) => mirror.notebook(id, notebook),
    ),
  create: (name) => createNotebook(getSupabase(), name),
  rename: (id, name) => renameNotebook(getSupabase(), id, name),
  remove: (id) => deleteNotebook(getSupabase(), id),
  chapters: () =>
    throughMirror(
      () => listChapters(getSupabase()),
      (mirror, chapters) => mirror.chapters(chapters),
    ),
  createChapter: (notebookId, name) => createChapter(getSupabase(), notebookId, name),
  renameChapter: (id, name) => renameChapter(getSupabase(), id, name),
  removeChapter: (id) => deleteChapter(getSupabase(), id),
};
