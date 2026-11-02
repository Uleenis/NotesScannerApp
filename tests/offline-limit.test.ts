import type { Allowance } from "@/capture/allowance";
import { offlineAllowance, putLimit, readLimit } from "@/offline/limit";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";

import { resetOffline } from "./fake-offline";
import { USER } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));

const READ_AT = "2026-10-20T10:00:00.000Z";

function month(extra: Partial<Allowance> = {}): Allowance {
  return { isAnonymous: false, used: 5, max: 15, remaining: 10, resetsAt: "2026-10-31T23:00:00.000Z", blockedReason: null, ...extra };
}

describe("the limit known without a network", () => {
  it("is the pages left at the last reading minus the pages that wait", () => {
    expect(offlineAllowance({ allowance: month(), readAt: READ_AT }, 3, new Date("2026-10-21T10:00:00Z"))).toMatchObject({
      remaining: 7,
      used: 8,
      blockedReason: null,
    });
  });

  it("never goes below zero and then blocks for the reason of the account", () => {
    const known = { allowance: month({ remaining: 2, used: 13 }), readAt: READ_AT };
    expect(offlineAllowance(known, 5, new Date("2026-10-21T10:00:00Z"))).toMatchObject({ remaining: 0, blockedReason: "monthly_limit" });
    const trial = { allowance: month({ isAnonymous: true, max: 3, used: 2, remaining: 1, resetsAt: null }), readAt: READ_AT };
    expect(offlineAllowance(trial, 1, new Date("2026-10-21T10:00:00Z"))).toMatchObject({ remaining: 0, blockedReason: "anonymous_limit" });
  });

  it("goes back to the whole tier once the month has changed since the reading", () => {
    const known = { allowance: month({ remaining: 0, used: 15, blockedReason: "monthly_limit" }), readAt: READ_AT };
    expect(offlineAllowance(known, 0, new Date("2026-10-31T23:00:00Z"))).toMatchObject({ remaining: 15, used: 0, blockedReason: null });
    expect(offlineAllowance(known, 4, new Date("2026-11-02T08:00:00Z"))).toMatchObject({ remaining: 11, used: 4, blockedReason: null });
  });

  it("keeps the block of the month until the month has changed", () => {
    const known = { allowance: month({ remaining: 0, used: 15, blockedReason: "monthly_limit" }), readAt: READ_AT };
    expect(offlineAllowance(known, 0, new Date("2026-10-30T10:00:00Z"))).toMatchObject({ remaining: 0, blockedReason: "monthly_limit" });
  });

  it("never gives back the pages of a trial account", () => {
    const known = {
      allowance: month({ isAnonymous: true, max: 3, used: 3, remaining: 0, resetsAt: null, blockedReason: "anonymous_limit" }),
      readAt: READ_AT,
    };
    expect(offlineAllowance(known, 0, new Date("2027-03-01T10:00:00Z"))).toMatchObject({ remaining: 0, blockedReason: "anonymous_limit" });
  });

  it("lifts the daily cap of a trial account on the next day in Paris", () => {
    const capped = {
      allowance: month({ isAnonymous: true, max: 3, used: 1, remaining: 2, resetsAt: null, blockedReason: "anonymous_daily_cap" }),
      readAt: "2026-10-20T21:30:00.000Z",
    };
    expect(offlineAllowance(capped, 0, new Date("2026-10-20T21:50:00Z"))).toMatchObject({ blockedReason: "anonymous_daily_cap" });
    expect(offlineAllowance(capped, 0, new Date("2026-10-20T22:30:00Z"))).toMatchObject({ blockedReason: null, remaining: 2 });
  });
});

describe("keeping the limit in the store", () => {
  let store: AccountStore;

  beforeEach(async () => {
    resetOffline();
    store = (await openAccountStore(USER)).store;
  });

  afterEach(async () => {
    await closeAccountStores();
  });

  it("knows nothing until it has been written", async () => {
    expect(await readLimit(store)).toBeNull();
  });

  it("writes one limit and replaces it", async () => {
    await putLimit(store, month(), READ_AT);
    await putLimit(store, month({ remaining: 4, used: 11 }), "2026-10-22T10:00:00.000Z");
    expect(await readLimit(store)).toEqual({ allowance: month({ remaining: 4, used: 11 }), readAt: "2026-10-22T10:00:00.000Z" });
  });

  it("reads nothing from a row that does not pass the guards", async () => {
    await store.database.runAsync("insert into known_limit (id, data, read_at) values (1, ?, ?)", [JSON.stringify({ remaining: "many" }), READ_AT]);
    expect(await readLimit(store)).toBeNull();
    await store.database.runAsync("delete from known_limit");
    await store.database.runAsync("insert into known_limit (id, data, read_at) values (1, ?, ?)", ["{broken", READ_AT]);
    expect(await readLimit(store)).toBeNull();
  });
});
