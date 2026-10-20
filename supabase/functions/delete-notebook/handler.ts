import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { idsFrom, refusalOutcome, refuseOutcome, removeFolders } from "../_shared/library.ts";
import type { LibraryDeps } from "../_shared/ports.ts";

export async function handleDeleteNotebook(request: Request, deps: LibraryDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const ids = await idsFrom(request, [{ name: "notebook_id" }]);
    if (!ids) return refuse(deps.log, { status: 400, code: "invalid_request" });
    const notebookId = ids.notebook_id as string;
    const { userId } = entry.caller;

    const pages = await deps.library.notebookPages(userId, notebookId);
    if (pages === null) return refuseOutcome(deps.log, "notebook_not_found");
    if (pages.some((page) => page.status === "processing")) return refuseOutcome(deps.log, "page_processing");

    await removeFolders(deps.library, ["photos", "alto"], userId, pages);
    const { outcome, pageIds } = await deps.library.deleteNotebook(userId, notebookId);
    if (refusalOutcome(outcome)) return refuseOutcome(deps.log, outcome);

    deps.log.event("notebook_deleted");
    try {
      const taken = [...new Set([...pages.map((page) => page.id), ...pageIds])];
      await removeFolders(deps.library, ["photos", "alto"], userId, taken.map((id) => ({ id })));
    } catch {
      deps.log.event("files_left");
    }
    return json(200, { deleted: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
