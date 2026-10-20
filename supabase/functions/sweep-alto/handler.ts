import { admitSweep, failed, json } from "../_shared/http.ts";
import type { SweepAltoDeps } from "../_shared/ports.ts";

const BATCH_SIZE = 500;
const MAX_BATCHES = 20;
const BUDGET_MS = 60_000;

export async function handleSweepAlto(request: Request, deps: SweepAltoDeps): Promise<Response> {
  let start: number | null = null;
  let removed = 0;
  try {
    const refused = await admitSweep(request, deps.secret, deps.log);
    if (refused) return refused;
    start = deps.clock.now();
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const paths = await deps.sweeps.orphans(BATCH_SIZE);
      if (paths.length === 0) break;
      const count = await deps.sweeps.remove(paths);
      removed += count;
      if (paths.length < BATCH_SIZE || count < paths.length || deps.clock.now() - start >= BUDGET_MS) break;
    }
    deps.log.event("alto_swept", { files: removed, durationMs: deps.clock.now() - start });
    return json(200, { removed });
  } catch (error) {
    if (start !== null) deps.log.event("alto_swept", { files: removed, durationMs: deps.clock.now() - start, code: "interrupted" });
    return failed(deps.log, error);
  }
}
