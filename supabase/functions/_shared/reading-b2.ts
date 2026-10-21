import { attemptReading, readingInput } from "./gemini-pass.ts";
import { errorName } from "./log.ts";
import type { ReadingDeps } from "./ports.ts";

export type SecondPass = {
  keep: (userId: string) => Promise<string | null>;
  cancel: () => void;
};

export function startSecondPass(deps: ReadingDeps, pageId: string, image: Uint8Array): SecondPass {
  const stop = new AbortController();
  const attempt = attemptReading(deps, pageId, image, "B2", stop.signal);
  let kept = false;

  return {
    keep: (userId) => {
      kept = true;
      const text = (async (): Promise<string | null> => {
        try {
          const done = await attempt;
          if (!done) {
            deps.log.event("b2_failed", { pageId });
            return null;
          }
          await deps.server.insertReading(userId, pageId, readingInput("B2", done));
          deps.log.event("b2_done", { pageId, durationMs: done.durationMs });
          return done.reading.text;
        } catch (error) {
          deps.log.event("unexpected_error", { errorName: errorName(error) });
          return null;
        }
      })();
      deps.background(text.then(() => undefined));
      return text;
    },
    cancel: () => {
      if (!kept) stop.abort();
    },
  };
}
