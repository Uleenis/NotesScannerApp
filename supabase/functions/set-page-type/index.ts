import { runInBackground } from "../_shared/background.ts";
import { consoleLogger } from "../_shared/log.ts";
import { readingServiceFrom } from "../_shared/reading-service.ts";
import { createAuth, createCallerStore, createPageTypeStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleSetPageType } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  forCaller: (token: string) => createCallerStore(keys, token),
  pageTypes: createPageTypeStore(keys),
  service: readingServiceFrom((name) => Deno.env.get(name), consoleLogger),
  background: runInBackground,
  clock: { now: () => Date.now() },
  log: consoleLogger,
};

Deno.serve((request) => handleSetPageType(request, deps));
