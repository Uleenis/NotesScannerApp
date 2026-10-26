import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer } from "react";

import { useAuth } from "@/auth/auth-provider";
import type { NumberedPage } from "@/pages/pages";
import { renderingFingerprint, type StoredRendering } from "./api";
import { renderService } from "./service";

export type RenderingView = { status: "off" } | { status: "loading" } | { status: "waiting" } | { status: "ready"; text: string } | { status: "fallback" };

type Attempt = { state: "pending"; done: Promise<void> } | { state: "failed"; retry: boolean };

const attempts = new Map<string, Attempt>();

export function resetRenderAttempts(): void {
  attempts.clear();
}

export function forgetRenderFailure(pageId: string): void {
  for (const [key, attempt] of attempts) {
    if (attempt.state === "failed" && attempt.retry && key.split(":")[1] === pageId) {
      attempts.delete(key);
    }
  }
}

export function useRendering(page: NumberedPage, active: boolean): RenderingView {
  const { status, userId } = useAuth();
  const queryClient = useQueryClient();
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const text = page.text ?? "";
  const fingerprint = useMemo(() => (active ? renderingFingerprint(text) : ""), [active, text]);
  const queryKey = ["page-rendering", userId, page.id];
  const stored = useQuery({
    queryKey,
    queryFn: () => renderService.read(page.id),
    enabled: active && status === "ready",
    staleTime: Infinity,
  });
  const current: StoredRendering | null = stored.data !== undefined && stored.data !== null && stored.data.basedOn === fingerprint ? stored.data : null;
  const key = `${userId}:${page.id}:${fingerprint}`;
  const attempt = attempts.get(key);
  const mustAsk = active && stored.isSuccess && current === null;

  useEffect(() => {
    if (!mustAsk) {
      return;
    }
    let known = attempts.get(key);
    if (known === undefined) {
      const done = renderService
        .render(page.id)
        .catch((): { status: "error" } => ({ status: "error" }))
        .then((outcome) => {
          if (outcome.status === "ready") {
            attempts.delete(key);
            queryClient.setQueryData<StoredRendering>(["page-rendering", userId, page.id], { text: outcome.text, basedOn: fingerprint });
          } else {
            attempts.set(key, { state: "failed", retry: outcome.status !== "discarded" });
          }
        });
      known = { state: "pending", done };
      attempts.set(key, known);
    }
    if (known.state !== "pending") {
      return;
    }
    let live = true;
    void known.done.then(() => {
      if (live) {
        refresh();
      }
    });
    return () => {
      live = false;
    };
  }, [mustAsk, key, page.id, userId, fingerprint, queryClient]);

  if (!active) {
    return { status: "off" };
  }
  if (stored.isError) {
    return { status: "fallback" };
  }
  if (!stored.isSuccess) {
    return { status: "loading" };
  }
  if (current !== null) {
    return { status: "ready", text: current.text };
  }
  return attempt?.state === "failed" ? { status: "fallback" } : { status: "waiting" };
}
