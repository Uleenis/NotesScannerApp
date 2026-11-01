import type { AccountStore } from "@/offline/store";
import { createOfflineSession, type SessionDeps } from "@/offline/session";

import { OTHER_USER, USER } from "./offline-fixtures";

function fakeStore(userId: string): AccountStore & { closed: boolean } {
  const store = {
    userId,
    closed: false,
    isOpen: () => !store.closed,
    close: async () => {
      store.closed = true;
    },
  };
  return store as unknown as AccountStore & { closed: boolean };
}

function setup(overrides: Partial<SessionDeps> = {}) {
  const state = {
    online: true,
    stores: [] as (AccountStore & { closed: boolean })[],
    current: null as AccountStore | null,
    synced: [] as string[],
    opens: 0,
    failOpen: false,
  };
  const deps: SessionDeps = {
    open: async (userId) => {
      state.opens += 1;
      if (state.failOpen) {
        throw new Error("key_unavailable");
      }
      const store = fakeStore(userId);
      state.stores.push(store);
      return store;
    },
    setStore: (store) => {
      state.current = store;
    },
    sync: async (store) => {
      state.synced.push(store.userId);
    },
    isOnline: () => state.online,
    ...overrides,
  };
  return { state, session: createOfflineSession(deps) };
}

describe("the offline store of the signed-in account", () => {
  it("opens the store of the account, makes it current and synchronises when online", async () => {
    const { state, session } = setup();
    await session.start(USER);
    expect(state.current?.userId).toBe(USER);
    expect(state.synced).toEqual([USER]);
  });

  it("opens the store but does not synchronise without a network", async () => {
    const { state, session } = setup();
    state.online = false;
    await session.start(USER);
    expect(state.current?.userId).toBe(USER);
    expect(state.synced).toEqual([]);
  });

  it("does nothing the second time for the same account", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await session.start(USER);
    expect(state.opens).toBe(1);
    expect(state.synced).toHaveLength(1);
  });

  it("closes the store of the account left and opens the one of the next", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await session.start(OTHER_USER);
    expect(state.stores[0].closed).toBe(true);
    expect(state.current?.userId).toBe(OTHER_USER);
  });

  it("drops the store when nobody is signed in", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await session.start(null);
    expect(state.current).toBeNull();
    expect(state.stores[0].closed).toBe(true);
  });

  it("falls back to the server when the store cannot be opened, and tries again at the foreground", async () => {
    const { state, session } = setup();
    state.failOpen = true;
    await expect(session.start(USER)).resolves.toBeUndefined();
    expect(state.current).toBeNull();
    state.failOpen = false;
    await session.foreground();
    expect(state.current?.userId).toBe(USER);
    expect(state.synced).toEqual([USER]);
  });

  it("does not make current a store opened for an account that is no longer the one", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { state, session } = setup({
      open: async (userId) => {
        await gate;
        const store = fakeStore(userId);
        state.stores.push(store);
        return store;
      },
    });
    const first = session.start(USER);
    const second = session.start(null);
    release();
    await Promise.all([first, second]);
    expect(state.current).toBeNull();
    expect(state.stores.every((store) => store.closed)).toBe(true);
  });
});

describe("when to synchronise", () => {
  it("synchronises when the network returns and at the foreground", async () => {
    const { state, session } = setup();
    state.online = false;
    await session.start(USER);
    state.online = true;
    await session.network(true);
    await session.foreground();
    expect(state.synced).toEqual([USER, USER]);
  });

  it("does not synchronise when the network goes away", async () => {
    const { state, session } = setup();
    await session.start(USER);
    state.online = false;
    await session.network(false);
    await session.foreground();
    expect(state.synced).toEqual([USER]);
  });

  it("does not synchronise without a store", async () => {
    const { state, session } = setup();
    await session.network(true);
    await session.foreground();
    expect(state.synced).toEqual([]);
  });

  it("never fails because a synchronisation failed", async () => {
    const { session } = setup({
      sync: async () => {
        throw new Error("The pages could not be loaded.");
      },
    });
    await expect(session.start(USER)).resolves.toBeUndefined();
    await expect(session.network(true)).resolves.toBeUndefined();
  });

  it("stops synchronising after stop", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await session.stop();
    await session.network(true);
    expect(state.synced).toEqual([USER]);
    expect(state.current).toBeNull();
  });
});
