import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { refreshPages } from "@/pages/queries";
import type { CreateChapterResult, RenameChapterResult } from "./chapters";
import type { CreateNotebookResult, RenameNotebookResult } from "./notebooks";
import type { DeleteResult } from "./removal";
import { notebookService } from "./service";

export function useNotebooks() {
  const { status, userId } = useAuth();
  return useQuery({
    queryKey: ["notebooks", userId],
    queryFn: () => notebookService.list(),
    enabled: status === "ready",
  });
}

export function useNotebook(id: string | null) {
  const { status, userId } = useAuth();
  return useQuery({
    queryKey: ["notebook", userId, id],
    queryFn: () => (id === null ? Promise.resolve(null) : notebookService.get(id)),
    enabled: status === "ready" && id !== null,
  });
}

export function useCreateNotebook() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<CreateNotebookResult, Error, string>({
    mutationFn: (name) => notebookService.create(name),
    onSuccess: async (result) => {
      if (result.status === "created") {
        queryClient.setQueryData(["notebook", userId, result.notebook.id], result.notebook);
        await queryClient.invalidateQueries({ queryKey: ["notebooks", userId] });
      }
    },
  });
}

export function useChapters() {
  const { status, userId } = useAuth();
  return useQuery({
    queryKey: ["chapters", userId],
    queryFn: () => notebookService.chapters(),
    enabled: status === "ready",
  });
}

export function useCreateChapter() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<CreateChapterResult, Error, { notebookId: string; name: string }>({
    mutationFn: ({ notebookId, name }) => notebookService.createChapter(notebookId, name),
    onSuccess: async (result) => {
      if (result.status === "created") {
        await refreshPages(queryClient, userId);
      }
    },
  });
}

export function useRenameNotebook() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<RenameNotebookResult, Error, { id: string; name: string }>({
    mutationFn: ({ id, name }) => notebookService.rename(id, name),
    onSuccess: async (result) => {
      if (result.status === "renamed") {
        await refreshPages(queryClient, userId);
      }
    },
  });
}

export function useRenameChapter() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<RenameChapterResult, Error, { id: string; name: string }>({
    mutationFn: ({ id, name }) => notebookService.renameChapter(id, name),
    onSuccess: async (result) => {
      if (result.status === "renamed") {
        await refreshPages(queryClient, userId);
      }
    },
  });
}

export function useDeleteNotebook() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<DeleteResult, Error, string>({
    mutationFn: (id) => notebookService.remove(id),
    onSuccess: (result) => {
      if (result.status === "deleted" || result.status === "missing") {
        void refreshPages(queryClient, userId);
      }
    },
  });
}

export function useDeleteChapter() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<DeleteResult, Error, string>({
    mutationFn: (id) => notebookService.removeChapter(id),
    onSuccess: (result) => {
      if (result.status === "deleted" || result.status === "missing") {
        void refreshPages(queryClient, userId);
      }
    },
  });
}
