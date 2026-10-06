import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import type { SendInput, SendResult } from "./send-page";
import { captureService } from "./service";

export function useAllowance() {
  const { status, userId } = useAuth();
  return useQuery({
    queryKey: ["allowance", userId],
    queryFn: () => captureService.allowance(),
    enabled: status === "ready",
  });
}

export function useLatestNotebookId() {
  const { status, userId } = useAuth();
  return useQuery({
    queryKey: ["latest-notebook", userId],
    queryFn: () => captureService.latestNotebookId(),
    enabled: status === "ready",
  });
}

export function useSendPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<SendResult, Error, SendInput>({
    mutationFn: (input) => captureService.send(input),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notebooks", userId] }),
        queryClient.invalidateQueries({ queryKey: ["notebook", userId] }),
        queryClient.invalidateQueries({ queryKey: ["allowance", userId] }),
        queryClient.invalidateQueries({ queryKey: ["latest-notebook", userId] }),
      ]);
    },
  });
}
