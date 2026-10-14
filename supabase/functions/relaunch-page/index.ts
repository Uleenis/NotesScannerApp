import { runInBackground } from "../_shared/background.ts";
import { createGeminiReader } from "../_shared/gemini.ts";
import { consoleLogger } from "../_shared/log.ts";
import { readingServiceFrom } from "../_shared/reading-service.ts";
import { createServerStore, createServiceReader, readKeys } from "../_shared/supabase-adapters.ts";
import { handleRelaunchPage } from "./handler.ts";

const MIN_SECRET_LENGTH = 32;

const keys = readKeys((name) => Deno.env.get(name));

const geminiKey = Deno.env.get("GEMINI_API_KEY");
if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");

const secret = Deno.env.get("RELAUNCH_SECRET");
if (!secret || secret.length < MIN_SECRET_LENGTH) throw new Error("RELAUNCH_SECRET is not set or too short");

const deps = {
  secret,
  reader: createServiceReader(keys),
  server: createServerStore(keys),
  gemini: createGeminiReader({ apiKey: geminiKey }),
  service: readingServiceFrom((name) => Deno.env.get(name)),
  background: runInBackground,
  clock: { now: () => Date.now() },
  log: consoleLogger,
};

Deno.serve((request) => handleRelaunchPage(request, deps));
