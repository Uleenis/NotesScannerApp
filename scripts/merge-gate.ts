export type PullRequest = {
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  mergeable: string;
  body: string;
};

export type Check = {
  name: string;
  bucket: string;
};

export type Run = {
  status: string;
  conclusion: string;
};

export type DeployState = {
  name: string;
  functions: string[];
  clean: boolean;
  head: string;
  main: string;
  runs: Run[];
};

export const REVIEW_HEADING = "## Review";

export const REQUIRED_CHECKS = ["app", "functions", "database", "secrets"];

export const GUARDED_PATHS = [
  ".claude/",
  ".githooks/",
  ".github/",
  "scripts/",
  "tests/merge-gate.test.ts",
  "tests/guardrails.test.ts",
  "tests/supabase-auth-config.test.ts",
  "supabase/config.toml",
  "package.json",
  "audit-ci.json",
  ".nvmrc",
  ".gitignore",
  ".gitattributes",
  "eslint.config.js",
  "tsconfig.json",
  "tests/setup.ts",
];

export const PRODUCTION_REF = "eapxcxcxapfrylxuzjsy";

function isGuarded(path: string): boolean {
  const lower = path.toLowerCase();
  return GUARDED_PATHS.some((guarded) => {
    const target = guarded.toLowerCase();
    return target.endsWith("/") ? lower.startsWith(target) : lower === target;
  });
}

export function mergeRefusals(pr: PullRequest, checks: Check[], files: string[], mainIsAncestor: boolean): string[] {
  const refusals: string[] = [];
  if (pr.state !== "OPEN") refusals.push(`the pull request is ${pr.state.toLowerCase()}, not open`);
  if (pr.isDraft) refusals.push("the pull request is a draft");
  if (pr.baseRefName !== "main") refusals.push(`the pull request targets ${pr.baseRefName}, not main`);
  if (pr.headRefName === "main") refusals.push("the pull request comes from main");
  if (pr.mergeable !== "MERGEABLE") refusals.push(`GitHub reports the pull request as ${pr.mergeable}, not mergeable`);
  if (!mainIsAncestor) refusals.push("the branch does not contain the last commit of main: CI did not test what would be merged");
  if (!pr.body.split(/\r?\n/).some((line) => line.trimEnd() === REVIEW_HEADING)) {
    refusals.push(`the description has no "${REVIEW_HEADING}" line`);
  }
  for (const name of REQUIRED_CHECKS) {
    const runs = checks.filter((candidate) => candidate.name === name);
    if (runs.length === 0) refusals.push(`required check "${name}" has not run on the last commit`);
    const failing = runs.find((check) => check.bucket !== "pass");
    if (failing !== undefined) refusals.push(`required check "${name}" is ${failing.bucket}`);
  }
  for (const check of checks) {
    if (!REQUIRED_CHECKS.includes(check.name) && check.bucket !== "pass" && check.bucket !== "skipping") {
      refusals.push(`check "${check.name}" is ${check.bucket}`);
    }
  }
  const guarded = files.filter(isGuarded);
  if (guarded.length > 0) refusals.push(`the pull request changes guarded files, which the owner merges: ${guarded.join(", ")}`);
  return refusals;
}

export function mergeArguments(number: string, headRefOid: string): string[] {
  return ["pr", "merge", number, "--merge", "--match-head-commit", headRefOid];
}

export function deployRefusals(state: DeployState): string[] {
  const refusals: string[] = [];
  if (!state.functions.includes(state.name)) refusals.push(`"${state.name}" is not an Edge Function of the repository`);
  if (!state.clean) refusals.push("the working tree has changes: only what is on main is deployed");
  if (state.head !== state.main) refusals.push("HEAD is not the last commit of main: only what is on main is deployed");
  const run = state.runs[0];
  if (run === undefined) refusals.push("CI has not run on the last commit of main");
  else if (run.status !== "completed" || run.conclusion !== "success") {
    refusals.push(`CI on the last commit of main is ${run.status} ${run.conclusion}`.trim());
  }
  return refusals;
}

export function deployArguments(name: string): string[] {
  return ["supabase", "functions", "deploy", name, "--project-ref", PRODUCTION_REF];
}
