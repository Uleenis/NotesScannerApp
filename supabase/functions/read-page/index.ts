import { runInBackground } from "../_shared/background.ts";
import { createGeminiReader } from "../_shared/gemini.ts";
import { consoleLogger } from "../_shared/log.ts";
import { readingServiceFrom } from "../_shared/reading-service.ts";
import { createAuth, createCallerStore, createServerStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleReadPage } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const geminiKey = Deno.env.get("GEMINI_API_KEY");
if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");

const deps = {
  auth: createAuth(keys),
  forCaller: (token: string) => createCallerStore(keys, token),
  server: createServerStore(keys),
  gemini: createGeminiReader({ apiKey: geminiKey }),
  service: readingServiceFrom((name) => Deno.env.get(name)),
  background: runInBackground,
  clock: { now: () => Date.now() },
  log: consoleLogger,
};

Deno.serve((request) => handleReadPage(request, deps));
