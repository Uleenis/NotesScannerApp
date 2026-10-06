import { admitScheduler, failed } from "../_shared/http.ts";
import type { RelaunchPageDeps } from "../_shared/ports.ts";
import { readPage } from "../_shared/reading.ts";

export async function handleRelaunchPage(request: Request, deps: RelaunchPageDeps): Promise<Response> {
  try {
    const entry = await admitScheduler(request, deps.secret, deps.log);
    if (entry instanceof Response) return entry;
    return await readPage(deps, { kind: "scheduler", pages: deps.reader }, entry.pageId);
  } catch (error) {
    return failed(deps.log, error);
  }
}
