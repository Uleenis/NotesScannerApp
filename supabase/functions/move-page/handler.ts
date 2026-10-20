import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { idsFrom, refusalOutcome, refuseOutcome } from "../_shared/library.ts";
import type { LibraryDeps } from "../_shared/ports.ts";

export async function handleMovePage(request: Request, deps: LibraryDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const ids = await idsFrom(request, [{ name: "page_id" }, { name: "notebook_id" }, { name: "chapter_id", nullable: true }]);
    if (!ids) return refuse(deps.log, { status: 400, code: "invalid_request" });
    const pageId = ids.page_id as string;

    const outcome = await deps.library.movePage(entry.caller.userId, pageId, ids.notebook_id as string, ids.chapter_id);
    if (refusalOutcome(outcome)) return refuseOutcome(deps.log, outcome, pageId);

    deps.log.event("page_moved", { pageId });
    return json(200, { moved: outcome === "moved" });
  } catch (error) {
    return failed(deps.log, error);
  }
}
