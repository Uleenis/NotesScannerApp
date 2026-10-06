import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import type { CreateNotebookResult } from "./notebooks";
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
