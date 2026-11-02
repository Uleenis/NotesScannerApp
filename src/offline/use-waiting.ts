import { useEffect, useState } from "react";

import { readStore } from "./cached";
import { readQueue, type QueuedPage } from "./queue";
import { useQueueVersion } from "./queue-state";
import { useStoreReady } from "./store-ready";

export function useWaitingPages(): QueuedPage[] | null {
  const version = useQueueVersion();
  const ready = useStoreReady();
  const [list, setList] = useState<QueuedPage[] | null>(null);

  useEffect(() => {
    let live = true;
    void readStore(readQueue).then((found) => {
      if (live) {
        setList(found ?? (ready ? [] : null));
      }
    });
    return () => {
      live = false;
    };
  }, [version, ready]);

  return list;
}
