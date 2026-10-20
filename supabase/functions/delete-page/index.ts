import { consoleLogger } from "../_shared/log.ts";
import { createAuth, createLibraryStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleDeletePage } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  library: createLibraryStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handleDeletePage(request, deps));
