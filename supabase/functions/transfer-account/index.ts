import { consoleLogger } from "../_shared/log.ts";
import { createAccountStore, createAuth, createTransferStore, readKeys } from "../_shared/supabase-adapters.ts";
import { handleTransferAccount } from "./handler.ts";

const keys = readKeys((name) => Deno.env.get(name));

const deps = {
  auth: createAuth(keys),
  transfers: createTransferStore(keys),
  accounts: createAccountStore(keys),
  log: consoleLogger,
};

Deno.serve((request) => handleTransferAccount(request, deps));
