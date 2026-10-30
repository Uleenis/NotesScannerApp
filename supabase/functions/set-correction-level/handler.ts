import { admitCaller, failed, json, refuse, UUID } from "../_shared/http.ts";
import type { CorrectionLevel, LevelOutcome, SetCorrectionLevelDeps } from "../_shared/ports.ts";
import type { Refusal } from "../_shared/refusals.ts";

type Wanted = { notebookId: string; level: CorrectionLevel };

const LEVELS: readonly string[] = ["course", "journal", "grammar"];

const REFUSALS: Record<Exclude<LevelOutcome, "set">, Refusal> = {
  notebook_not_found: { status: 404, code: "notebook_not_found" },
  requires_model: { status: 409, code: "requires_model" },
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
  if (Object.keys(fields).some((key) => key !== "notebook_id" && key !== "level")) return null;
  const notebookId = fields.notebook_id;
  const level = fields.level;
  if (typeof notebookId !== "string" || !UUID.test(notebookId)) return null;
  if (typeof level !== "string" || !LEVELS.includes(level)) return null;
  return { notebookId: notebookId.toLowerCase(), level: level as CorrectionLevel };
}

export async function handleSetCorrectionLevel(request: Request, deps: SetCorrectionLevelDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const wanted = await wantedFrom(request);
    if (!wanted) return refuse(deps.log, { status: 400, code: "invalid_request" });
    const outcome = await deps.levels.set(entry.caller.userId, wanted.notebookId, wanted.level);
    if (outcome !== "set") return refuse(deps.log, REFUSALS[outcome]);
    deps.log.event("correction_level_set", { code: wanted.level });
    return json(200, { level: wanted.level });
  } catch (error) {
    return failed(deps.log, error);
  }
}
