import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import type { Allowance } from "./allowance";
import type { SendInput, SendResult } from "./send-page";
import { captureService } from "./service";

const FRESH_ALLOWANCE_WAIT_MS = 1500;

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
    retry: false,
  });
}

export async function freshAllowance(queryClient: QueryClient, userId: string | null): Promise<Allowance | null | undefined> {
  const queryKey = ["allowance", userId];
  const known = () => queryClient.getQueryData<Allowance | null>(queryKey);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<Allowance | null | undefined>((resolve) => {
    timer = setTimeout(() => resolve(known()), FRESH_ALLOWANCE_WAIT_MS);
  });
  const asked = queryClient.fetchQuery({ queryKey, queryFn: () => captureService.allowance(), staleTime: 0 }).catch(known);
  try {
    return await Promise.race([asked, waited]);
  } finally {
    clearTimeout(timer);
  }
}

export function useSendPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pages", userId] }),
      queryClient.invalidateQueries({ queryKey: ["notebooks", userId] }),
      queryClient.invalidateQueries({ queryKey: ["notebook", userId] }),
      queryClient.invalidateQueries({ queryKey: ["allowance", userId] }),
      queryClient.invalidateQueries({ queryKey: ["latest-notebook", userId] }),
    ]);

  return useMutation<SendResult, Error, SendInput>({
    mutationFn: (input) =>
      captureService.send(input, () => {
        void refresh();
      }),
    onSettled: () => {
      void refresh();
    },
  });
}
