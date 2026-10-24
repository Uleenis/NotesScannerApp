import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { searchService } from "./service";

export function useSearch(query: string, notebookId: string | null) {
  const { status, userId } = useAuth();
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", userId, notebookId, trimmed],
    queryFn: () => searchService.search(trimmed, notebookId),
    enabled: status === "ready" && trimmed !== "",
    gcTime: 60_000,
  });
}

export function useAnchor(pageId: string, tokenIndex: number | null) {
  const { status, userId } = useAuth();
  return useQuery({
    queryKey: ["anchor", userId, pageId, tokenIndex],
    queryFn: () => (tokenIndex === null ? Promise.resolve(null) : searchService.anchor(pageId, tokenIndex)),
    enabled: status === "ready" && tokenIndex !== null,
    retry: false,
  });
}
