import { readStore } from "@/offline/cached";
import { offlineAllowance, readLimit } from "@/offline/limit";
import { readQueue } from "@/offline/queue";
import type { Allowance } from "./allowance";

export async function offlineLimit(): Promise<Allowance | null> {
  const known = await readStore(async (store) => {
    const limit = await readLimit(store);
    if (limit === null) {
      return undefined;
    }
    return offlineAllowance(limit, (await readQueue(store)).length, new Date());
  });
  return known ?? null;
}
