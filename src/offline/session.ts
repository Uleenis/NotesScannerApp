import type { AccountStore } from "./store";

export type SessionDeps = {
  open: (userId: string) => Promise<AccountStore>;
  setStore: (store: AccountStore | null) => void;
  sync: (store: AccountStore) => Promise<unknown>;
  isOnline: () => boolean;
};

export type OfflineSession = {
  start: (userId: string | null) => Promise<void>;
  stop: () => Promise<void>;
  foreground: () => Promise<void>;
  network: (online: boolean) => Promise<void>;
};

export function createOfflineSession(deps: SessionDeps): OfflineSession {
  let wanted: string | null = null;
  let store: AccountStore | null = null;
  let generation = 0;

  async function release(): Promise<void> {
    const left = store;
    store = null;
    deps.setStore(null);
    if (left !== null) {
      await left.close().catch(() => undefined);
    }
  }

  function held(): AccountStore | null {
    if (store !== null && !store.isOpen()) {
      store = null;
      deps.setStore(null);
    }
    return store;
  }

  async function synchronise(): Promise<void> {
    const open = held();
    if (open === null || !deps.isOnline()) {
      return;
    }
    try {
      await deps.sync(open);
    } catch {
      return;
    }
  }

  async function open(userId: string): Promise<void> {
    let opened: AccountStore;
    try {
      opened = await deps.open(userId);
    } catch {
      return;
    }
    if (wanted !== userId) {
      await opened.close().catch(() => undefined);
      return;
    }
    if (store === null) {
      store = opened;
      deps.setStore(opened);
    }
  }

  return {
    async start(userId) {
      if (userId === wanted && (userId === null || store !== null)) {
        return;
      }
      generation += 1;
      const mine = generation;
      wanted = userId;
      await release();
      if (userId === null) {
        return;
      }
      await open(userId);
      if (mine === generation) {
        await synchronise();
      }
    },
    async stop() {
      generation += 1;
      wanted = null;
      await release();
    },
    async foreground() {
      if (wanted === null) {
        return;
      }
      if (held() === null) {
        await open(wanted);
      }
      await synchronise();
    },
    async network(online) {
      if (online) {
        await synchronise();
      }
    },
  };
}
