import { consoleLogger } from "../_shared/log.ts";
import { createAuth, createCallerStore, createServerStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handlePreparePage } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  forCaller: (token: string) => createCallerStore(keys, token),
  server: createServerStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handlePreparePage(request, deps));
