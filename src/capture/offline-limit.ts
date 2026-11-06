import { readStore } from "@/offline/cached";
import { offlineAllowance, readLimit } from "@/offline/limit";
import { isOnline } from "@/offline/network";
import { readQueue } from "@/offline/queue";
import type { AccountStore } from "@/offline/store";
import type { Allowance } from "./allowance";

export async function knownLimit(store: AccountStore): Promise<Allowance | null | undefined> {
  const limit = await readLimit(store);
  if (limit === null) {
    return isOnline() ? undefined : null;
  }
  return offlineAllowance(limit, (await readQueue(store)).length, new Date());
}

export async function offlineLimit(): Promise<Allowance | null> {
  return (await readStore(knownLimit)) ?? null;
}
