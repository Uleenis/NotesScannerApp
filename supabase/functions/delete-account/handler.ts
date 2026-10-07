import { admitCaller, failed, json } from "../_shared/http.ts";
import type { DeleteAccountDeps } from "../_shared/ports.ts";

export async function handleDeleteAccount(request: Request, deps: DeleteAccountDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const { userId } = entry.caller;

    await deps.accounts.removePhotos(userId);
    await deps.accounts.deleteUser(userId);

    deps.log.event("account_deleted");
    return json(200, { deleted: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
