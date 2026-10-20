import { consoleLogger } from "../_shared/log.ts";
import { createSweepStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleSweepAlto } from "./handler.ts";

const MIN_SECRET_LENGTH = 32;

const keys = readKeys((name) => Deno.env.get(name));

const secret = Deno.env.get("SWEEP_SECRET");
if (!secret || secret.length < MIN_SECRET_LENGTH) throw new Error("SWEEP_SECRET is not set or too short");

const deps = {
  secret,
  sweeps: createSweepStore(keys),
  clock: { now: () => Date.now() },
  log: consoleLogger,
};

Deno.serve((request) => handleSweepAlto(request, deps));
