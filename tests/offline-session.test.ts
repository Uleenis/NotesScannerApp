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
    queued: [] as string[],
    order: [] as string[],
    failQueue: false,
    opens: 0,
    failOpen: false,
    swept: [] as string[],
    wiped: [] as string[],
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
      state.order.push("sync");
    },
    sendQueue: async (store) => {
      state.queued.push(store.userId);
      state.order.push("queue");
      if (state.failQueue) {
        throw new Error("queue");
      }
    },
    isOnline: () => state.online,
    sweep: async (keep) => {
      state.swept.push(keep);
      state.order.push(`sweep:${state.opens}`);
    },
    wipe: async (userId) => {
      state.wiped.push(userId);
      state.order.push("wipe");
      return 2;
    },
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

describe("overlapping openings", () => {
  it("opens again at the foreground when the store it holds has been closed", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await state.stores[0].close();
    await session.foreground();
    expect(state.opens).toBe(2);
    expect(state.current).toBe(state.stores[1]);
    expect(state.synced).toEqual([USER, USER]);
  });

  it("keeps the store open when the same account is wanted again while it opens", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shared = fakeStore(USER);
    const { state, session } = setup({
      open: async () => {
        await gate;
        return shared;
      },
    });
    const first = session.start(USER);
    const second = session.foreground();
    release();
    await Promise.all([first, second]);
    expect(shared.closed).toBe(false);
    expect(state.current).toBe(shared);
  });

  it("closes a store opened for an account that is no longer wanted", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const opening = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const stale = fakeStore(USER);
    const { state, session } = setup({
      open: async (userId) => {
        if (userId === USER) {
          entered();
          await gate;
          return stale;
        }
        return fakeStore(userId);
      },
    });
    const first = session.start(USER);
    await opening;
    await session.start(OTHER_USER);
    release();
    await first;
    expect(stale.closed).toBe(true);
    expect(state.current?.userId).toBe(OTHER_USER);
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

describe("sending the waiting pages", () => {
  it("sends the queue before synchronising, at the start, when online", async () => {
    const { state, session } = setup();
    await session.start(USER);
    expect(state.order).toEqual(["sweep:0", "queue", "sync"]);
    expect(state.queued).toEqual([USER]);
  });

  it("does not send without a network", async () => {
    const { state, session } = setup();
    state.online = false;
    await session.start(USER);
    expect(state.queued).toEqual([]);
  });

  it("sends at the return to the foreground and at the return of the network", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await session.foreground();
    await session.network(true);
    await session.network(false);
    expect(state.queued).toEqual([USER, USER, USER]);
  });

  it("still synchronises when the sending of the queue fails", async () => {
    const { state, session } = setup();
    state.failQueue = true;
    await session.start(USER);
    expect(state.synced).toEqual([USER]);
  });

  it("sends nothing for an account that is not signed in", async () => {
    const { state, session } = setup();
    await session.start(null);
    await session.foreground();
    expect(state.queued).toEqual([]);
  });
});

describe("the stores of other accounts", () => {
  it("are swept once the signed-in account is confirmed, before its store opens, and once per account", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await session.start(USER);
    await session.foreground();

    expect(state.swept).toEqual([USER]);
    expect(state.order[0]).toBe("sweep:0");
  });

  it("are not swept for an account kept from the stored session without a network, only once it is confirmed", async () => {
    const { state, session } = setup();
    state.online = false;
    await session.start(USER, false);
    expect(state.swept).toEqual([]);
    expect(state.current?.userId).toBe(USER);

    await session.start(USER, true);
    expect(state.swept).toEqual([USER]);
    expect(state.opens).toBe(1);
  });

  it("are swept again for the next account", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await session.start(null);
    await session.start(OTHER_USER);

    expect(state.swept).toEqual([USER, OTHER_USER]);
  });

  it("do not stop the store of the account from opening when the sweep fails", async () => {
    const { state, session } = setup({
      sweep: async () => {
        throw new Error("busy");
      },
    });
    await session.start(USER);

    expect(state.current?.userId).toBe(USER);
  });
});

describe("leaving an account", () => {
  it("drops and closes its store, wipes it, and answers the waiting pages lost", async () => {
    const { state, session } = setup();
    await session.start(USER);

    expect(await session.leave(USER)).toBe(2);

    expect(state.current).toBeNull();
    expect(state.stores[0].closed).toBe(true);
    expect(state.wiped).toEqual([USER]);
  });

  it("never opens its store again afterwards, at the foreground or when the network returns", async () => {
    const { state, session } = setup();
    await session.start(USER);
    await session.leave(USER);

    await session.foreground();
    await session.network(true);

    expect(state.opens).toBe(1);
    expect(state.current).toBeNull();
  });

  it("does not make current a store whose opening ends after the account was left", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const opening = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { state, session } = setup({
      open: async (userId) => {
        entered();
        await gate;
        const store = fakeStore(userId);
        state.stores.push(store);
        return store;
      },
    });
    const starting = session.start(USER);
    await opening;
    const leaving = session.leave(USER);
    release();
    await Promise.all([starting, leaving]);

    expect(state.current).toBeNull();
    expect(state.stores[0].closed).toBe(true);
    expect(state.wiped).toEqual([USER]);
  });

  it("of an account that is not the current one wipes it and leaves the current store alone", async () => {
    const { state, session } = setup();
    await session.start(OTHER_USER);

    await session.leave(USER);

    expect(state.wiped).toEqual([USER]);
    expect(state.current?.userId).toBe(OTHER_USER);
  });
});

describe("leaving an account while its store is still being prepared", () => {
  it("stops before the store opens, so the store of the account left never opens", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { state, session } = setup({
      sweep: async () => {
        await gate;
      },
    });
    const starting = session.start(USER);
    const leaving = session.leave(USER);
    release();
    await Promise.all([starting, leaving]);

    expect(state.opens).toBe(0);
    expect(state.current).toBeNull();
    expect(state.wiped).toEqual([USER]);
  });
});

describe("a sweep overtaken by another account", () => {
  it("is told to stop as soon as another account, or nobody, is wanted", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checks: (() => boolean)[] = [];
    const { session } = setup({
      sweep: async (keep, still) => {
        checks.push(still);
        if (keep === USER) {
          await gate;
        }
      },
    });
    const first = session.start(USER);
    await Promise.resolve();
    expect(checks[0]()).toBe(true);

    await session.start(OTHER_USER);
    expect(checks[0]()).toBe(false);
    expect(checks[1]()).toBe(true);

    await session.start(null);
    expect(checks[1]()).toBe(false);
    release();
    await first;
  });
});
