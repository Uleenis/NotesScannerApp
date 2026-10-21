import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef } from "react";

import { useAuth } from "@/auth/auth-provider";
import { blockFor } from "./allowance";
import { limitParams } from "./limit-route";
import { freshAllowance, useAllowance } from "./queries";

export function useOpenCapture(notebookId?: string, chapterId?: string | null): () => Promise<void> {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  useAllowance();
  const opening = useRef(false);

  return async () => {
    if (opening.current) {
      return;
    }
    opening.current = true;
    try {
      const block = blockFor(await freshAllowance(queryClient, userId));
      if (block !== null) {
        router.push({ pathname: "/limit", params: limitParams(block) });
        return;
      }
      if (notebookId === undefined) {
        router.push("/capture");
      } else if (chapterId === undefined || chapterId === null) {
        router.push({ pathname: "/capture", params: { notebook: notebookId } });
      } else {
        router.push({ pathname: "/capture", params: { notebook: notebookId, chapter: chapterId } });
      }
    } finally {
      opening.current = false;
    }
  };
}
