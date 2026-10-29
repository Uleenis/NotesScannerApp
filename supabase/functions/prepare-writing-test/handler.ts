import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import type { PrepareWritingTestDeps, WritingBegin } from "../_shared/ports.ts";
import type { Refusal } from "../_shared/refusals.ts";
import { isTemplate, SHEETS, sheetPath } from "../_shared/writing-test.ts";
import type { WritingTemplate } from "../_shared/writing-test.ts";

const REFUSALS: Record<Exclude<WritingBegin["outcome"], "started">, Refusal> = {
  consent_required: { status: 403, code: "consent_required" },
  test_in_progress: { status: 409, code: "test_in_progress" },
  test_limit: { status: 429, code: "test_limit" },
};

async function templateFrom(request: Request): Promise<WritingTemplate | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).length !== 1 || !isTemplate(fields.template)) return null;
  return fields.template;
}

async function eraseExpired(deps: PrepareWritingTestDeps, userId: string, expired: readonly string[]): Promise<void> {
  for (const testId of expired) {
    try {
      await deps.tests.removeTestFiles(userId, testId);
    } catch {
      deps.log.event("writing_test_files_left");
    }
  }
}

export async function handlePrepareWritingTest(request: Request, deps: PrepareWritingTestDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const template = await templateFrom(request);
    if (template === null) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const { userId } = entry.caller;
    const begun = await deps.tests.begin(userId, template);
    await eraseExpired(deps, userId, begun.expired);
    if (begun.outcome !== "started") return refuse(deps.log, REFUSALS[begun.outcome]);
    const testId = begun.testId;
    if (testId === null) return failed(deps.log, new Error("begin"));

    try {
      const uploads = [];
      for (const sheet of SHEETS) {
        const path = sheetPath(userId, testId, sheet);
        const upload = await deps.tests.createUploadUrl(path);
        uploads.push({ path, token: upload.token });
      }
      deps.log.event("writing_test_started");
      return json(200, { test_id: testId, uploads });
    } catch (error) {
      await deps.tests.fail(userId, testId).catch(() => false);
      return failed(deps.log, error);
    }
  } catch (error) {
    return failed(deps.log, error);
  }
}
