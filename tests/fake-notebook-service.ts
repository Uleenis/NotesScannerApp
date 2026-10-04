import type { NotebookSummary } from "@/notebooks/notebooks";
import { notebookService } from "@/notebooks/service";

export function installFakeNotebooks(initial: NotebookSummary[] = []) {
  const store: NotebookSummary[] = [...initial];

  jest.mocked(notebookService.list).mockImplementation(async () => [...store]);
  jest.mocked(notebookService.get).mockImplementation(async (id) => store.find((notebook) => notebook.id === id) ?? null);
  jest.mocked(notebookService.create).mockImplementation(async (rawName) => {
    const name = rawName.trim();
    if (name === "") {
      return { status: "empty" };
    }
    if (store.some((notebook) => notebook.name === name)) {
      return { status: "duplicate", name };
    }
    const notebook = { id: `notebook-${store.length + 1}`, name, pageCount: 0 };
    store.push(notebook);
    return { status: "created", notebook };
  });

  return store;
}

export const histoire: NotebookSummary = { id: "histoire-id", name: "Histoire", pageCount: 8 };
export const sciences: NotebookSummary = { id: "sciences-id", name: "Sciences", pageCount: 0 };
