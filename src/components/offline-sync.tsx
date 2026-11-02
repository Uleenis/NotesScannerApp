import { useNetworkState } from "expo-network";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { realQueueDeps } from "@/capture/queue-service";
import { defaultSyncDeps, signedInUser } from "@/offline/default-sync";
import { setMirrorIdentity, setMirrorStore } from "@/offline/mirror";
import { sendQueue } from "@/offline/queue-send";
import { noteLost } from "@/offline/queue-state";
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
      open: async (id) => {
        const opened = await openAccountStore(id);
        noteLost(opened.lostPending);
        return opened.store;
      },
      setStore: setMirrorStore,
      sync: (store) => syncStore(store, defaultSyncDeps(store.userId, () => now.free && AppState.currentState === "active")),
      sendQueue: (store) => sendQueue(store, realQueueDeps()),
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
