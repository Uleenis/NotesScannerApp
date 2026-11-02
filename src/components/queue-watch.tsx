import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { subscribeQueue } from "@/offline/queue-state";

const QUEUE_REFRESH_DELAY_MS = 600;

const KEYS = ["allowance", "pages", "notebooks", "notebook", "chapters", "latest-notebook", "page"];

export function QueueWatch() {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stop = subscribeQueue(() => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        KEYS.forEach((key) => void queryClient.invalidateQueries({ queryKey: [key] }));
      }, QUEUE_REFRESH_DELAY_MS);
    });
    return () => {
      stop();
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, [queryClient]);

  return null;
}
