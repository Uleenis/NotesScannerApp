import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { editFrom } from "../_shared/page-edit.ts";
import type { EditDeps, EditOutcome } from "../_shared/ports.ts";
import type { Refusal } from "../_shared/refusals.ts";

const REFUSALS: Record<Exclude<EditOutcome, "edited">, Refusal> = {
  page_not_found: { status: 404, code: "page_not_found" },
  page_not_read: { status: 409, code: "page_not_read" },
  unsupported_script: { status: 409, code: "unsupported_script" },
  not_editable: { status: 409, code: "not_editable" },
  text_mismatch: { status: 409, code: "text_changed" },
  invalid_edit: { status: 422, code: "invalid_edit" },
};

export async function handleEditPage(request: Request, deps: EditDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const edit = await editFrom(request);
    if (!edit) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const outcome = await deps.edits.editPage(entry.caller.userId, edit.pageId, edit.text, edit.words, edit.gaps);
    if (outcome !== "edited") return refuse(deps.log, REFUSALS[outcome], edit.pageId);

    deps.log.event("page_edited", { pageId: edit.pageId });
    return json(200, { edited: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
