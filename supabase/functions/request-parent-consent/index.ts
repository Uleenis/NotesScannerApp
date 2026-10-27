import { consoleLogger } from "../_shared/log.ts";
import { mailerFrom } from "../_shared/parent-consent.ts";
import { createAuth, createParentConsentStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleRequestParentConsent } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  parents: createParentConsentStore(keys),
  mailer: mailerFrom((name) => Deno.env.get(name)),
  log: consoleLogger,
};

Deno.serve((request) => handleRequestParentConsent(request, deps));
