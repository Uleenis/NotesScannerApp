import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useEffect, useRef } from "react";

import { useAuth } from "@/auth/auth-provider";
import type { DeleteResult } from "@/notebooks/removal";
import type { MoveResult, PageStatus, SetTypeResult, StartResult, SwitchableType } from "./pages";
import { pageService } from "./service";
import { LIST_POLL_MS, PAGE_POLL_MS } from "./timing";

const PHOTO_URL_STALE_MS = 50 * 60_000;

function isUnsettled(status: PageStatus): boolean {
  return status === "queued" || status === "processing";
}

export function refreshPages(queryClient: QueryClient, userId: string | null): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["pages", userId] }),
    queryClient.invalidateQueries({ queryKey: ["notebooks", userId] }),
    queryClient.invalidateQueries({ queryKey: ["notebook", userId] }),
    queryClient.invalidateQueries({ queryKey: ["chapters", userId] }),
    queryClient.invalidateQueries({ queryKey: ["allowance", userId] }),
    queryClient.invalidateQueries({ queryKey: ["latest-notebook", userId] }),
  ]);
}

export function usePages() {
  const { status, userId } = useAuth();
  const focused = useIsFocused();
  return useQuery({
    queryKey: ["pages", userId],
    queryFn: () => pageService.list(),
    enabled: status === "ready",
    refetchInterval: (query) => (focused && query.state.data?.some((page) => isUnsettled(page.status)) ? LIST_POLL_MS : false),
  });
}

export function usePage(id: string) {
  const { status, userId } = useAuth();
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["page", userId, id],
    queryFn: () => pageService.get(id),
    enabled: status === "ready",
    refetchInterval: (current) => {
      const page = current.state.data;
      return focused && page !== null && page !== undefined && isUnsettled(page.status) ? PAGE_POLL_MS : false;
    },
  });

  const state = query.data === undefined || query.data === null ? null : `${query.data.status}:${query.data.queueReason ?? ""}`;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current !== null && state !== null && previous.current !== state) {
      void refreshPages(queryClient, userId);
    }
    previous.current = state;
  }, [state, queryClient, userId]);

  return query;
}

export function usePhotoUrl(pageId: string) {
  const { status, userId } = useAuth();
  return useQuery({
    queryKey: ["photo-url", userId, pageId],
    queryFn: () => (userId === null ? Promise.reject(new Error("No account.")) : pageService.photoUrl(userId, pageId)),
    enabled: status === "ready" && userId !== null,
    staleTime: PHOTO_URL_STALE_MS,
  });
}

export function useStartReading() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<StartResult, Error, string>({
    mutationFn: (pageId) => pageService.startReading(pageId),
    onSettled: async (_result, _error, pageId) => {
      await queryClient.invalidateQueries({ queryKey: ["page", userId, pageId] });
      await refreshPages(queryClient, userId);
    },
  });
}

export function useSetPageType(pageId: string) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<SetTypeResult, Error, SwitchableType>({
    mutationFn: (pageType) => pageService.setPageType(pageId, pageType),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["page", userId, pageId] });
    },
  });
}

export function useMovePage(pageId: string) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<MoveResult, Error, { notebookId: string; chapterId: string | null }>({
    mutationFn: ({ notebookId, chapterId }) => pageService.move(pageId, notebookId, chapterId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["page", userId, pageId] });
      await refreshPages(queryClient, userId);
    },
  });
}

export function useDeletePage(pageId: string) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<DeleteResult, Error, void>({
    mutationFn: () => pageService.remove(pageId),
    onSuccess: (result) => {
      if (result.status === "deleted" || result.status === "missing") {
        void refreshPages(queryClient, userId);
      }
    },
  });
}
