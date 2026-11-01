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

  async function synchronise(): Promise<void> {
    if (store === null || !deps.isOnline()) {
      return;
    }
    try {
      await deps.sync(store);
    } catch {
      return;
    }
  }

  async function open(userId: string, mine: number): Promise<void> {
    let opened: AccountStore;
    try {
      opened = await deps.open(userId);
    } catch {
      return;
    }
    if (mine !== generation || wanted !== userId) {
      await opened.close().catch(() => undefined);
      return;
    }
    store = opened;
    deps.setStore(opened);
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
      await open(userId, mine);
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
      if (store === null) {
        generation += 1;
        await open(wanted, generation);
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
