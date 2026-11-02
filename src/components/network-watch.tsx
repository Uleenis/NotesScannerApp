import { useQueryClient } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useEffect, useRef } from "react";

import { setOnline } from "@/offline/network";
import { useStoreReady } from "@/offline/store-ready";

export function NetworkWatch() {
  const network = useNetworkState();
  const queryClient = useQueryClient();
  const online = network.isConnected !== false;
  const was = useRef(online);
  const storeReady = useStoreReady();

  useEffect(() => {
    setOnline(online);
    if (online && !was.current) {
      void queryClient.invalidateQueries();
    }
    was.current = online;
  }, [online, queryClient]);

  useEffect(() => {
    if (storeReady) {
      void queryClient.invalidateQueries({ predicate: (query) => query.state.status === "error" });
    }
  }, [storeReady, queryClient]);

  useEffect(() => () => setOnline(true), []);

  return null;
}
