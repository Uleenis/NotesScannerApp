import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const number = process.argv[2] ?? "";

if (!/^\d+$/.test(number)) {
  console.error("Usage: node scripts/merge-pr.mjs <pull-request-number>");
  process.exit(2);
}

function run(file, args) {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gh(args) {
  try {
    return run("gh", args);
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim() !== "") return error.stdout;
    if (args[1] === "checks") return "[]";
    throw error;
  }
}

function succeeds(file, args) {
  try {
    run(file, args);
    return true;
  } catch {
    return false;
  }
}

run("git", ["fetch", "--quiet", "origin", "main", `pull/${number}/head`]);

if (!succeeds("git", ["diff", "--quiet", "origin/main", "--", "scripts", ".githooks", ".claude"])) {
  console.error("The scripts, hooks or Claude settings of this copy differ from main: run the merge from a copy whose guardrails are main's.");
  process.exit(1);
}

const gateDirectory = mkdtempSync(join(tmpdir(), "merge-gate-"));
const gatePath = join(gateDirectory, "merge-gate.ts");
writeFileSync(gatePath, run("git", ["show", "origin/main:scripts/merge-gate.ts"]));
const { mergeRefusals, mergeArguments, packageRefusals, lockRefusals } = await import(pathToFileURL(gatePath).href);
rmSync(gateDirectory, { recursive: true, force: true });

function view() {
  return JSON.parse(
    gh(["pr", "view", number, "--json", "state,isDraft,baseRefName,headRefName,mergeable,body,headRefOid"]),
  );
}

let pr = view();
for (let attempt = 0; pr.mergeable === "UNKNOWN" && attempt < 5; attempt += 1) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  pr = view();
}

const checks = JSON.parse(gh(["pr", "checks", number, "--json", "name,bucket"]));
const files = run("git", ["diff", "--name-only", "--no-renames", "-z", "origin/main", pr.headRefOid])
  .split("\0")
  .filter((path) => path !== "");
const mainIsAncestor = succeeds("git", ["merge-base", "--is-ancestor", "origin/main", pr.headRefOid]);
function fileAt(revision, path) {
  try {
    return run("git", ["show", `${revision}:${path}`]);
  } catch {
    return null;
  }
}

const refusals = [
  ...mergeRefusals(pr, checks, files, mainIsAncestor),
  ...(files.includes("package.json")
    ? packageRefusals(fileAt("origin/main", "package.json"), fileAt(pr.headRefOid, "package.json"))
    : []),
  ...(files.includes("package-lock.json") ? lockRefusals(fileAt(pr.headRefOid, "package-lock.json")) : []),
];

if (refusals.length > 0) {
  console.error(`Pull request #${number} is not merged:`);
  for (const refusal of refusals) console.error(`- ${refusal}`);
  process.exit(1);
}

execFileSync("gh", mergeArguments(number, pr.headRefOid), { stdio: "inherit" });
console.log(`Pull request #${number} merged at ${pr.headRefOid}.`);
