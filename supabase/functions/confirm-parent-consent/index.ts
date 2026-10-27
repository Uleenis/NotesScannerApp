import { consoleLogger } from "../_shared/log.ts";
import { createAuth, createParentConsentStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleConfirmParentConsent } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  parents: createParentConsentStore(keys),
  mailer: null,
  log: consoleLogger,
};

Deno.serve((request) => handleConfirmParentConsent(request, deps));
