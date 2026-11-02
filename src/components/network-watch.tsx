import { useQueryClient } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useEffect, useRef } from "react";

import { setOnline } from "@/offline/network";

export function NetworkWatch() {
  const network = useNetworkState();
  const queryClient = useQueryClient();
  const online = network.isConnected !== false;
  const was = useRef(online);

  useEffect(() => {
    setOnline(online);
    if (online && !was.current) {
      void queryClient.invalidateQueries();
    }
    was.current = online;
  }, [online, queryClient]);

  useEffect(() => () => setOnline(true), []);

  return null;
}
