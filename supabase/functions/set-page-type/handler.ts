import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { errorName } from "../_shared/log.ts";
import { looksLikeJpeg, MAX_PHOTO_BYTES, photoPath } from "../_shared/photo.ts";
import type { SetPageTypeDeps, SwitchOutcome } from "../_shared/ports.ts";
import { startReadingA } from "../_shared/reading-a.ts";
import type { Refusal } from "../_shared/refusals.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Wanted = { pageId: string; pageType: "text" | "math" };

const REFUSALS: Record<Exclude<SwitchOutcome, "switched" | "unchanged">, Refusal> = {
  page_not_found: { status: 404, code: "page_not_found" },
  page_not_read: { status: 409, code: "page_not_read" },
  unsupported_script: { status: 409, code: "unsupported_script" },
  no_reading: { status: 409, code: "no_reading" },
};

async function wantedFrom(request: Request): Promise<Wanted | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => key !== "page_id" && key !== "page_type")) return null;
  const pageId = fields.page_id;
  const pageType = fields.page_type;
  if (typeof pageId !== "string" || !UUID.test(pageId)) return null;
  if (pageType !== "text" && pageType !== "math") return null;
  return { pageId: pageId.toLowerCase(), pageType };
}

async function toMath(deps: SetPageTypeDeps, userId: string, pageId: string): Promise<Response> {
  const { outcome, altoPath } = await deps.pageTypes.setMath(userId, pageId);
  if (outcome !== "switched" && outcome !== "unchanged") return refuse(deps.log, REFUSALS[outcome], pageId);
  if (altoPath) {
    try {
      await deps.pageTypes.removeAlto(altoPath);
    } catch (error) {
      deps.log.event("alto_left", { pageId, errorName: errorName(error) });
    }
  }
  deps.log.event("page_type_set", { pageId, code: outcome === "switched" ? "math" : "math_unchanged" });
  return json(200, { page_type: "math" });
}

async function toText(deps: SetPageTypeDeps, token: string, userId: string, pageId: string): Promise<Response> {
  const { outcome, b1 } = await deps.pageTypes.setText(userId, pageId, deps.service !== null);
  if (outcome !== "switched" && outcome !== "unchanged") return refuse(deps.log, REFUSALS[outcome], pageId);
  deps.log.event("page_type_set", { pageId, code: outcome === "switched" ? "text" : "text_unchanged" });
  if (outcome === "switched" && b1 === null) deps.log.event("a_abandoned", { pageId, code: deps.service ? "relaunch_limit" : "no_service" });
  if (outcome === "switched" && b1 !== null) await readAgain(deps, token, userId, pageId, b1);
  return json(200, { page_type: "text" });
}

async function readAgain(deps: SetPageTypeDeps, token: string, userId: string, pageId: string, b1: string): Promise<void> {
  if (!deps.service) return;
  let image: Uint8Array | null;
  try {
    image = await deps.forCaller(token).downloadPhoto(photoPath(userId, pageId));
  } catch (error) {
    deps.log.event("a_abandoned", { pageId, code: "photo_unreadable", errorName: errorName(error) });
    return;
  }
  if (!image || image.length > MAX_PHOTO_BYTES || !looksLikeJpeg(image)) {
    deps.log.event("a_abandoned", { pageId, code: "photo_missing" });
    return;
  }
  startReadingA({ service: deps.service, background: deps.background, clock: deps.clock, log: deps.log }, userId, pageId, image).finish(b1);
}

export async function handleSetPageType(request: Request, deps: SetPageTypeDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const wanted = await wantedFrom(request);
    if (!wanted) return refuse(deps.log, { status: 400, code: "invalid_request" });
    const userId = entry.caller.userId;
    if (wanted.pageType === "math") return await toMath(deps, userId, wanted.pageId);
    return await toText(deps, entry.token, userId, wanted.pageId);
  } catch (error) {
    return failed(deps.log, error);
  }
}
