import { consoleLogger } from "../_shared/log.ts";
import { createAuth, createLevelStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleSetCorrectionLevel } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  levels: createLevelStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handleSetCorrectionLevel(request, deps));
