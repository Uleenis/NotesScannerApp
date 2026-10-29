import { failed, json, refuse } from "../_shared/http.ts";
import type { TrainingDeps } from "../_shared/ports.ts";
import { admitTraining, taskIdOf } from "../_shared/training.ts";

export async function handleTrainingUpload(request: Request, deps: TrainingDeps): Promise<Response> {
  try {
    const body = await admitTraining(request, deps.secret, deps.log);
    if (body instanceof Response) return body;
    const taskId = taskIdOf(body);
    if (!taskId) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const target = await deps.training.uploadTarget(taskId);
    if (target.outcome !== "ready" || target.path === null) {
      return refuse(deps.log, { status: target.outcome === "task_not_found" ? 404 : 409, code: target.outcome });
    }
    const url = await deps.training.signedUpload(target.path);
    deps.log.event("training_upload", { code: "ready" });
    return json(200, { url });
  } catch (error) {
    return failed(deps.log, error);
  }
}
