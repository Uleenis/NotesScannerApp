import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { idsFrom, refusalOutcome, refuseOutcome } from "../_shared/library.ts";
import type { LibraryDeps } from "../_shared/ports.ts";

export async function handleDeleteChapter(request: Request, deps: LibraryDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const ids = await idsFrom(request, [{ name: "chapter_id" }]);
    if (!ids) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const outcome = await deps.library.deleteChapter(entry.caller.userId, ids.chapter_id as string);
    if (refusalOutcome(outcome)) return refuseOutcome(deps.log, outcome);

    deps.log.event("chapter_deleted");
    return json(200, { deleted: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
