import { admitCaller, failed, json } from "../_shared/http.ts";
import type { RevokeTrainingDeps } from "../_shared/ports.ts";

export async function handleRevokeTraining(request: Request, deps: RevokeTrainingDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const { userId } = entry.caller;

    await deps.training.removeFiles(userId);
    await deps.training.revoke(userId);

    deps.log.event("training_revoked");
    try {
      await deps.training.removeFiles(userId);
    } catch {
      deps.log.event("training_files_left");
    }
    return json(200, { revoked: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
