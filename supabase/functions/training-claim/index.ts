import { consoleLogger } from "../_shared/log.ts";
import { createTrainingStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleTrainingClaim } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  secret: Deno.env.get("TRAINING_SECRET") ?? "",
  training: createTrainingStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handleTrainingClaim(request, deps));
