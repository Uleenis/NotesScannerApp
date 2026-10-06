import { admit, failed } from "../_shared/http.ts";
import type { ReadPageDeps } from "../_shared/ports.ts";
import { readPage } from "../_shared/reading.ts";

export async function handleReadPage(request: Request, deps: ReadPageDeps): Promise<Response> {
  try {
    const entry = await admit(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const { token, caller, pageId } = entry;
    return await readPage(deps, { kind: "owner", userId: caller.userId, pages: deps.forCaller(token) }, pageId);
  } catch (error) {
    return failed(deps.log, error);
  }
}
