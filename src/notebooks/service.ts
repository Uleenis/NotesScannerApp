import { getSupabase } from "@/lib/supabase";
import {
  createNotebook,
  getNotebook,
  listNotebooks,
  type CreateNotebookResult,
  type NotebookSummary,
} from "./notebooks";

export type NotebookService = {
  list: () => Promise<NotebookSummary[]>;
  get: (id: string) => Promise<NotebookSummary | null>;
  create: (name: string) => Promise<CreateNotebookResult>;
};

export const notebookService: NotebookService = {
  list: () => listNotebooks(getSupabase()),
  get: (id) => getNotebook(getSupabase(), id),
  create: (name) => createNotebook(getSupabase(), name),
};
