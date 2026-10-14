import { admitCaller, failed, json } from "../_shared/http.ts";
import { ACCOUNT_BUCKETS } from "../_shared/ports.ts";
import type { DeleteAccountDeps } from "../_shared/ports.ts";

export async function handleDeleteAccount(request: Request, deps: DeleteAccountDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const { userId } = entry.caller;

    for (const bucket of ACCOUNT_BUCKETS) {
      await deps.accounts.removeFiles(bucket, userId);
    }
    await deps.accounts.deleteUser(userId);

    deps.log.event("account_deleted");
    try {
      await deps.accounts.removeFiles("alto", userId);
    } catch {
      deps.log.event("account_files_left");
    }
    return json(200, { deleted: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
