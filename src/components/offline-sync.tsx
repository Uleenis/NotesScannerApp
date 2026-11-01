import { useNetworkState } from "expo-network";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { defaultSyncDeps, signedInUser } from "@/offline/default-sync";
import { setMirrorIdentity, setMirrorStore } from "@/offline/mirror";
import { createOfflineSession } from "@/offline/session";
import { openAccountStore } from "@/offline/store";
import { syncStore } from "@/offline/sync";

const FREE_NETWORKS: readonly string[] = ["WIFI", "ETHERNET"];

let now = { online: true, free: false };

export function OfflineSync() {
  const { status, userId } = useAuth();
  const network = useNetworkState();
  const online = network.isConnected !== false;
  const free = online && network.type !== undefined && FREE_NETWORKS.includes(network.type);
  useEffect(() => {
    now = { online, free };
  }, [online, free]);

  const [session] = useState(() =>
    createOfflineSession({
      open: async (id) => (await openAccountStore(id)).store,
      setStore: setMirrorStore,
      sync: (store) => syncStore(store, defaultSyncDeps(store.userId, () => now.free && AppState.currentState === "active")),
      isOnline: () => now.online,
    }),
  );

  const account = status === "ready" ? userId : null;

  useEffect(() => {
    setMirrorIdentity(signedInUser);
    return () => setMirrorIdentity(null);
  }, []);

  useEffect(() => {
    void session.start(account);
  }, [session, account]);

  useEffect(() => () => void session.stop(), [session]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void session.foreground();
      }
    });
    return () => subscription.remove();
  }, [session]);

  const wasOnline = useRef(online);
  const wasFree = useRef(free);
  useEffect(() => {
    if ((online && !wasOnline.current) || (free && !wasFree.current)) {
      void session.network(true);
    }
    wasOnline.current = online;
    wasFree.current = free;
  }, [online, free, session]);

  return null;
}
