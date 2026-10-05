import { admit, failed, json, refuse } from "../_shared/http.ts";
import { photoPath } from "../_shared/photo.ts";
import type { PreparePageDeps } from "../_shared/ports.ts";
import { refusalForAllowance, refusalForStatus } from "../_shared/refusals.ts";

export async function handlePreparePage(request: Request, deps: PreparePageDeps): Promise<Response> {
  try {
    const entry = await admit(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const { token, caller, pageId } = entry;
    const store = deps.forCaller(token);

    const page = await store.getPage(pageId);
    if (!page || page.userId !== caller.userId) {
      return refuse(deps.log, { status: 404, code: "page_not_found" }, pageId);
    }
    const unreadable = refusalForStatus(page.status);
    if (unreadable) return refuse(deps.log, unreadable, pageId);

    const path = photoPath(caller.userId, pageId);
    if (await store.photoInfo(path)) {
      return refuse(deps.log, { status: 409, code: "photo_exists" }, pageId);
    }

    const allowance = await store.allowance();
    if (!allowance) return refuse(deps.log, { status: 401, code: "unauthenticated" }, pageId);
    const blocked = refusalForAllowance(allowance);
    if (blocked) return refuse(deps.log, blocked, pageId);

    const upload = await deps.server.createUploadUrl(path);
    deps.log.event("upload_prepared", { pageId });
    return json(200, { path, token: upload.token, signed_url: upload.signedUrl });
  } catch (error) {
    return failed(deps.log, error);
  }
}
