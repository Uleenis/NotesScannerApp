import { createGeminiRenderer } from "../_shared/gemini-render.ts";
import { consoleLogger } from "../_shared/log.ts";
import { createAuth, createRenderStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleRenderPage } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const geminiKey = Deno.env.get("GEMINI_API_KEY");
if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");

const deps = {
  auth: createAuth(keys),
  renders: createRenderStore(keys),
  gemini: createGeminiRenderer({ apiKey: geminiKey }),
  clock: { now: () => Date.now() },
  log: consoleLogger,
};

Deno.serve((request) => handleRenderPage(request, deps));
