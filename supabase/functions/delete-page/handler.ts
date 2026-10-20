import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { idsFrom, refusalOutcome, refuseOutcome, removeFolders } from "../_shared/library.ts";
import type { LibraryDeps } from "../_shared/ports.ts";

export async function handleDeletePage(request: Request, deps: LibraryDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const ids = await idsFrom(request, [{ name: "page_id" }]);
    if (!ids) return refuse(deps.log, { status: 400, code: "invalid_request" });
    const pageId = ids.page_id as string;
    const { userId } = entry.caller;

    const status = await deps.library.pageStatus(userId, pageId);
    if (status === null) return refuseOutcome(deps.log, "page_not_found", pageId);
    if (status === "processing") return refuseOutcome(deps.log, "page_processing", pageId);

    await removeFolders(deps.library, ["photos", "alto"], userId, [{ id: pageId }]);
    const outcome = await deps.library.deletePage(userId, pageId);
    if (refusalOutcome(outcome)) return refuseOutcome(deps.log, outcome, pageId);

    deps.log.event("page_deleted", { pageId });
    try {
      await removeFolders(deps.library, ["alto"], userId, [{ id: pageId }]);
    } catch {
      deps.log.event("files_left", { pageId });
    }
    return json(200, { deleted: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
