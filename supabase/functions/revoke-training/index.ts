import { consoleLogger } from "../_shared/log.ts";
import { createAuth, createRevokeStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleRevokeTraining } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  training: createRevokeStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handleRevokeTraining(request, deps));
