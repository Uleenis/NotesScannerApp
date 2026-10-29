import { admitCaller, failed, json, refuse, UUID } from "../_shared/http.ts";
import { errorName } from "../_shared/log.ts";
import { looksLikeJpeg, MAX_PHOTO_BYTES } from "../_shared/photo.ts";
import type { CheckWritingTestDeps, SheetCounts, WritingFinish } from "../_shared/ports.ts";
import type { ReadingService, ServiceFailure } from "../_shared/reading-service.ts";
import { SHEETS, sheetPath } from "../_shared/writing-test.ts";
import type { Sheet, WritingTemplate } from "../_shared/writing-test.ts";

const REFUSED_SHEET_CODES = ["invalid_photo", "too_large", "unsupported_media_type", "too_complex"];

const MAX_TRAINING = { 1: 20, 2: 10 } as const;
const MAX_VALIDATION = 10;

type Kept = { training: number; validation: number };

class ServiceUnavailable extends Error {
  readonly failure: ServiceFailure;

  constructor(failure: ServiceFailure) {
    super(failure.kind);
    this.name = "ServiceUnavailable";
    this.failure = failure;
  }
}

async function testIdFrom(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).length !== 1 || typeof fields.test_id !== "string" || !UUID.test(fields.test_id)) return null;
  return fields.test_id.toLowerCase();
}

async function readSheet(
  deps: CheckWritingTestDeps,
  service: ReadingService,
  userId: string,
  testId: string,
  template: WritingTemplate,
  sheet: Sheet,
): Promise<Kept> {
  const image = await deps.tests.downloadPhoto(sheetPath(userId, testId, sheet));
  if (image === null || image.length > MAX_PHOTO_BYTES || !looksLikeJpeg(image)) return { training: 0, validation: 0 };
  const checked = await service.checkWriting(template, sheet, image, new AbortController().signal);
  if (checked.ok) {
    return {
      training: Math.min(checked.training, MAX_TRAINING[sheet]),
      validation: sheet === 2 ? Math.min(checked.validation, MAX_VALIDATION) : 0,
    };
  }
  const { failure } = checked;
  if (failure.kind === "http_error" && failure.code !== undefined && REFUSED_SHEET_CODES.includes(failure.code)) {
    return { training: 0, validation: 0 };
  }
  throw new ServiceUnavailable(failure);
}

async function erase(deps: CheckWritingTestDeps, userId: string, testIds: readonly string[]): Promise<void> {
  for (const testId of testIds) {
    try {
      await deps.tests.removeTestFiles(userId, testId);
    } catch {
      deps.log.event("writing_test_files_left");
    }
  }
}

async function settle(deps: CheckWritingTestDeps, userId: string, testId: string, finished: WritingFinish, counts: SheetCounts): Promise<void> {
  deps.log.event("writing_test_checked", {
    code: finished.outcome,
    training: counts.sheet1Training + counts.sheet2Training,
    validation: counts.sheet2Validation,
  });
  if (finished.outcome === "accepted") await erase(deps, userId, finished.replaced);
  else if (finished.outcome !== "test_not_found") await erase(deps, userId, [testId]);
}

async function run(deps: CheckWritingTestDeps, service: ReadingService, userId: string, testId: string, template: WritingTemplate): Promise<void> {
  try {
    const first = await readSheet(deps, service, userId, testId, template, SHEETS[0]);
    const second = await readSheet(deps, service, userId, testId, template, SHEETS[1]);
    const counts: SheetCounts = { sheet1Training: first.training, sheet2Training: second.training, sheet2Validation: second.validation };
    await settle(deps, userId, testId, await deps.tests.finish(userId, testId, counts), counts);
  } catch (error) {
    const failure = error instanceof ServiceUnavailable ? error.failure : null;
    deps.log.event("writing_test_failed", { errorName: errorName(error), kind: failure?.kind, status: failure?.status, code: failure?.code });
    let marked = false;
    try {
      marked = await deps.tests.fail(userId, testId);
    } catch {
      deps.log.event("writing_test_files_left");
    }
    if (marked) await erase(deps, userId, [testId]);
  }
}

export async function handleCheckWritingTest(request: Request, deps: CheckWritingTestDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const testId = await testIdFrom(request);
    if (testId === null) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const { userId } = entry.caller;
    const test = await deps.tests.pending(userId, testId);
    if (test === null) return refuse(deps.log, { status: 404, code: "test_not_found" });
    const { service } = deps;
    if (service === null) return refuse(deps.log, { status: 503, code: "unavailable" });

    if (!deps.running.has(testId)) {
      deps.running.add(testId);
      deps.background(run(deps, service, userId, testId, test.template).finally(() => deps.running.delete(testId)));
    }
    return json(202, { checking: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
