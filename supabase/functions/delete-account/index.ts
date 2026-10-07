import { consoleLogger } from "../_shared/log.ts";
import { createAccountStore, createAuth, readKeys } from "../_shared/supabase-adapters.ts";
import { handleDeleteAccount } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  accounts: createAccountStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handleDeleteAccount(request, deps));
