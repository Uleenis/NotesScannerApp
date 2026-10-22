import { consoleLogger } from "../_shared/log.ts";
import { createAuth, createEditStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleEditPage } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  edits: createEditStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handleEditPage(request, deps));
