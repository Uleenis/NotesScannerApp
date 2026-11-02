import type { AccountStore } from "./store";

export type SessionDeps = {
  open: (userId: string) => Promise<AccountStore>;
  setStore: (store: AccountStore | null) => void;
  sync: (store: AccountStore) => Promise<unknown>;
  sendQueue: (store: AccountStore) => Promise<unknown>;
  isOnline: () => boolean;
  sweep: (keep: string) => Promise<void>;
  wipe: (userId: string) => Promise<number>;
};

export type OfflineSession = {
  start: (userId: string | null, confirmed?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  foreground: () => Promise<void>;
  network: (online: boolean) => Promise<void>;
  leave: (userId: string) => Promise<number>;
};

export function createOfflineSession(deps: SessionDeps): OfflineSession {
  let wanted: string | null = null;
  let store: AccountStore | null = null;
  let generation = 0;
  let swept: string | null = null;

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

  async function sweepFor(userId: string): Promise<void> {
    if (swept === userId) {
      return;
    }
    swept = userId;
    try {
      await deps.sweep(userId);
    } catch {
      return;
    }
  }

  async function synchronise(): Promise<void> {
    const open = held();
    if (open === null || !deps.isOnline()) {
      return;
    }
    try {
      await deps.sendQueue(open);
    } catch {
      await Promise.resolve();
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
    async start(userId, confirmed = true) {
      if (userId === wanted && (userId === null || store !== null)) {
        if (userId !== null && confirmed) {
          await sweepFor(userId);
        }
        return;
      }
      generation += 1;
      const mine = generation;
      wanted = userId;
      await release();
      if (userId === null) {
        return;
      }
      if (confirmed) {
        await sweepFor(userId);
      }
      if (mine !== generation) {
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
    async leave(userId) {
      if (wanted === userId) {
        generation += 1;
        wanted = null;
        await release();
      }
      if (swept === userId) {
        swept = null;
      }
      return deps.wipe(userId);
    },
  };
}
