import { failed, json, refuse } from "../_shared/http.ts";
import { photoPath } from "../_shared/photo.ts";
import type { ClaimedTask, TrainingDeps } from "../_shared/ports.ts";
import { admitTraining, SIGNED_URL_SECONDS } from "../_shared/training.ts";
import { sheetPath } from "../_shared/writing-test.ts";

async function abandon(deps: TrainingDeps, task: ClaimedTask, code: string): Promise<Response> {
  await deps.training.report(task.taskId, { outcome: "failed" });
  deps.log.event("training_claimed", { code });
  return json(200, { task: null });
}

export async function handleTrainingClaim(request: Request, deps: TrainingDeps): Promise<Response> {
  try {
    const body = await admitTraining(request, deps.secret, deps.log);
    if (body instanceof Response) return body;
    if (Object.keys(body).length !== 0) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const task = await deps.training.claim();
    if (!task) {
      deps.log.event("training_claimed", { code: "none" });
      return json(200, { task: null });
    }

    const test = await deps.training.signedReads(
      "photos",
      [sheetPath(task.userId, task.testId, 1), sheetPath(task.userId, task.testId, 2)],
      SIGNED_URL_SECONDS,
    );
    if (test.some((url) => url === null)) return await abandon(deps, task, "test_missing");

    let model: { url: string; sha256: string } | null = null;
    if (task.model) {
      const [url] = await deps.training.signedReads("models", [task.model.path], SIGNED_URL_SECONDS);
      if (!url) return await abandon(deps, task, "model_missing");
      model = { url, sha256: task.model.sha256 };
    }

    const photos = await deps.training.signedReads(
      "photos",
      task.pages.map((page) => photoPath(task.userId, page.pageId)),
      SIGNED_URL_SECONDS,
    );
    const pages = task.pages.flatMap((page, index) => {
      const photo = photos[index];
      if (!photo) return [];
      return [{
        photo,
        b1: page.b1,
        language: page.language,
        corrections: page.corrections.map((correction) => ({
          token_index: correction.tokenIndex,
          text: correction.text,
          reading_a: correction.readingA,
        })),
      }];
    });

    deps.log.event("training_claimed", { code: "claimed", files: pages.length });
    return json(200, { task: { task_id: task.taskId, template: task.template, test, model, pages } });
  } catch (error) {
    return failed(deps.log, error);
  }
}
