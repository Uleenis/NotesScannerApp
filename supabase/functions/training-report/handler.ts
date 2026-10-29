import { errorName } from "../_shared/log.ts";
import { failed, json, refuse } from "../_shared/http.ts";
import type { TrainingDeps } from "../_shared/ports.ts";
import { admitTraining, reportOf } from "../_shared/training.ts";

const REFUSED: Record<string, number> = { task_not_found: 404, task_expired: 409, consent_required: 409 };

export async function handleTrainingReport(request: Request, deps: TrainingDeps): Promise<Response> {
  try {
    const body = await admitTraining(request, deps.secret, deps.log);
    if (body instanceof Response) return body;
    const parsed = reportOf(body);
    if (!parsed) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const { outcome, remove } = await deps.training.report(parsed.taskId, parsed.report);
    if (remove.length > 0) {
      try {
        await deps.training.removeModels(remove);
      } catch (error) {
        deps.log.event("files_left", { code: outcome, files: remove.length, errorName: errorName(error) });
      }
    }
    deps.log.event("training_reported", { code: outcome, files: remove.length });
    const status = REFUSED[outcome];
    return status ? json(status, { error: outcome }) : json(200, { outcome });
  } catch (error) {
    return failed(deps.log, error);
  }
}
