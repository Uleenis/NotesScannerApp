import { consoleLogger } from "../_shared/log.ts";
import { createAuth, createWritingTestStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handlePrepareWritingTest } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  tests: createWritingTestStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handlePrepareWritingTest(request, deps));
