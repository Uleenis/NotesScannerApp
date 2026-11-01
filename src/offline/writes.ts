import type { AccountStore } from "./store";

const tails = new WeakMap<AccountStore, Promise<void>>();

export function inWrite<T>(store: AccountStore, task: () => Promise<T>): Promise<T> {
  if (!store.isOpen()) {
    return Promise.reject(new Error("store_closed"));
  }
  const previous = tails.get(store) ?? Promise.resolve();
  const run = previous.then(() => {
    if (!store.isOpen()) {
      throw new Error("store_closed");
    }
    return task();
  });
  tails.set(
    store,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
