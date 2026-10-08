import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { movedPhotoPath } from "../_shared/photo.ts";
import type { TransferAccountDeps } from "../_shared/ports.ts";

const ACCOUNT_TOKEN_HEADER = "x-account-token";

const PAGE_PROCESSING = { status: 409, code: "page_processing" };

export async function handleTransferAccount(request: Request, deps: TransferAccountDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const from = entry.caller;

    const accountToken = request.headers.get(ACCOUNT_TOKEN_HEADER);
    const to = accountToken ? await deps.auth.verify(accountToken) : null;
    if (!to) return refuse(deps.log, { status: 401, code: "unauthenticated" });

    if (from.userId === to.userId) return refuse(deps.log, { status: 400, code: "same_account" });
    if (!from.isAnonymous) return refuse(deps.log, { status: 403, code: "not_anonymous" });
    if (to.isAnonymous) return refuse(deps.log, { status: 403, code: "target_anonymous" });
    if (await deps.transfers.hasProcessingPage(from.userId)) return refuse(deps.log, PAGE_PROCESSING);

    const copies = (await deps.transfers.listPhotos(from.userId)).map((path) => ({
      from: path,
      to: movedPhotoPath(path, from.userId, to.userId),
    }));
    for (const copy of copies) {
      await deps.transfers.copyPhoto(copy.from, copy.to);
    }
    const arrived = new Set(await deps.transfers.listPhotos(to.userId));
    if (copies.some((copy) => !arrived.has(copy.to))) throw new Error("PhotosMissing");

    const moved = await deps.transfers.moveRows(from.userId, to.userId);
    if (!moved.ok) return refuse(deps.log, PAGE_PROCESSING);

    await deps.accounts.removePhotos(from.userId);
    await deps.accounts.deleteUser(from.userId);

    deps.log.event("account_transferred");
    return json(200, { transferred: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
