import { runInBackground } from "../_shared/background.ts";
import { consoleLogger } from "../_shared/log.ts";
import { readingServiceFrom } from "../_shared/reading-service.ts";
import { createAuth, createWritingTestStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleCheckWritingTest } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  tests: createWritingTestStore(keys),
  service: readingServiceFrom((name) => Deno.env.get(name), consoleLogger),
  running: new Set<string>(),
  background: runInBackground,
  log: consoleLogger,
};

Deno.serve((request) => handleCheckWritingTest(request, deps));
