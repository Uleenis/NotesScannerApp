import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { deployArguments, deployRefusals } from "./merge-gate.ts";

const name = process.argv[2] ?? "";

if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("Usage: node scripts/deploy-function.mjs <function-name>");
  process.exit(2);
}

function run(file, args) {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

run("git", ["fetch", "--quiet", "origin", "main"]);

const functions = readdirSync("supabase/functions", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "tests")
  .map((entry) => entry.name);
const main = run("git", ["rev-parse", "origin/main"]);
const refusals = deployRefusals({
  name,
  functions,
  clean: run("git", ["status", "--porcelain"]) === "",
  head: run("git", ["rev-parse", "HEAD"]),
  main,
  runs: JSON.parse(run("gh", ["run", "list", "--commit", main, "--workflow", "Checks", "--json", "status,conclusion", "--limit", "1"])),
});

if (refusals.length > 0) {
  console.error(`${name} is not deployed:`);
  for (const refusal of refusals) console.error(`- ${refusal}`);
  process.exit(1);
}

execFileSync("npx", deployArguments(name), { stdio: "inherit", shell: process.platform === "win32" });
console.log(`${name} deployed from ${main}.`);
