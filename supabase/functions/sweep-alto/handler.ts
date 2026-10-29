import { admitSweep, failed, json } from "../_shared/http.ts";
import type { LogEvent } from "../_shared/log.ts";
import type { SweepAltoDeps, SweepKind } from "../_shared/ports.ts";

const BATCH_SIZE = 500;
const MAX_BATCHES = 20;
const BUDGET_MS = 60_000;
const KINDS: readonly [SweepKind, LogEvent][] = [["alto", "alto_swept"], ["models", "models_swept"], ["writingTests", "writing_tests_swept"]];

export async function handleSweepAlto(request: Request, deps: SweepAltoDeps): Promise<Response> {
  let start: number | null = null;
  let removed = 0;
  let failure: unknown = null;
  try {
    const refused = await admitSweep(request, deps.secret, deps.log);
    if (refused) return refused;
    start = deps.clock.now();
    for (const [kind, event] of KINDS) {
      let files = 0;
      try {
        const sweeps = deps.sweeps[kind];
        for (let batch = 0; batch < MAX_BATCHES; batch++) {
          const paths = await sweeps.orphans(BATCH_SIZE);
          if (paths.length === 0) break;
          const count = await sweeps.remove(paths);
          files += count;
          if (paths.length < BATCH_SIZE || count < paths.length || deps.clock.now() - start >= BUDGET_MS) break;
        }
        deps.log.event(event, { files, durationMs: deps.clock.now() - start });
      } catch (error) {
        failure ??= error;
        deps.log.event(event, { files, durationMs: deps.clock.now() - start, code: "interrupted" });
      }
      removed += files;
    }
    return failure === null ? json(200, { removed }) : failed(deps.log, failure);
  } catch (error) {
    return failed(deps.log, error);
  }
}
