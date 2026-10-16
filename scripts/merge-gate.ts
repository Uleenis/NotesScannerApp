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

export const REQUIRED_CHECKS = ["app", "functions", "database", "secrets", "reading"];

export const GUARDED_PATHS = [
  ".claude/",
  ".githooks/",
  ".github/",
  "scripts/",
  "tests/merge-gate.test.ts",
  "tests/guardrails.test.ts",
  "tests/supabase-auth-config.test.ts",
  "supabase/config.toml",
  "audit-ci.json",
  ".nvmrc",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".gitleaks.toml",
  ".gitleaksignore",
  ".babelrc",
  "babel.config.js",
  "jest.config.js",
  "jest.config.ts",
  "deno.json",
  "supabase/functions/deno.json",
  "eslint.config.js",
  "tsconfig.json",
  "tests/setup.ts",
  "services/reading/audit-allowlist.txt",
  "services/reading/check.sh",
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

export const DEPENDENCY_KEYS = ["dependencies", "devDependencies"];

export const FROZEN_PACKAGES = [
  "expo",
  "jest",
  "jest-expo",
  "typescript",
  "eslint",
  "eslint-config-expo",
  "audit-ci",
  "supabase",
  "@testing-library/react-native",
];

const PLAIN_VERSION = /^[~^]?\d+(\.\d+){0,2}(-[0-9A-Za-z.]+)?$/;

const NPM_REGISTRY = "https://registry.npmjs.org/";

function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function dependencyMap(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function packageRefusals(base: string | null, head: string | null): string[] {
  const before = parseObject(base);
  const after = parseObject(head);
  if (before === null || after === null) {
    return ["package.json cannot be read on main or on the branch: the owner merges this pull request"];
  }
  const refusals: string[] = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const otherKeys = keys.filter(
    (key) => !DEPENDENCY_KEYS.includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  if (otherKeys.length > 0) {
    refusals.push(
      `the pull request changes ${otherKeys.map((key) => `"${key}"`).join(", ")} in package.json, which the owner merges`,
    );
  }
  for (const key of DEPENDENCY_KEYS) {
    const old = dependencyMap(before[key]);
    const now = dependencyMap(after[key]);
    if (old === null || now === null) {
      refusals.push(`"${key}" of package.json is not a list of packages: the owner merges this pull request`);
      continue;
    }
    const names = [...new Set([...Object.keys(old), ...Object.keys(now)])].sort();
    for (const name of names) {
      if (old[name] === now[name]) continue;
      const value = now[name];
      if (FROZEN_PACKAGES.includes(name)) {
        refusals.push(`the pull request changes "${name}", which runs or shapes the checks: the owner merges it`);
      } else if (name in now && (typeof value !== "string" || !PLAIN_VERSION.test(value))) {
        refusals.push(`the pull request gives "${name}" a source other than a version of the npm registry: the owner merges it`);
      }
    }
  }
  return refusals;
}

export function lockRefusals(lock: string | null): string[] {
  const parsed = parseObject(lock);
  const packages = parsed === null || parsed.packages === undefined ? null : dependencyMap(parsed.packages);
  if (packages === null) return ["package-lock.json cannot be read on the branch: the owner merges this pull request"];
  const outside = Object.entries(packages).filter(([path, entry]) => {
    if (path === "") return false;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return true;
    const record = entry as Record<string, unknown>;
    if (record.link === true) return true;
    if (record.resolved === undefined) return false;
    return typeof record.resolved !== "string" || !record.resolved.startsWith(NPM_REGISTRY) || typeof record.integrity !== "string";
  });
  if (outside.length === 0) return [];
  return [
    `package-lock.json takes ${outside.length} package(s) from outside the npm registry, or without integrity: the owner merges this pull request`,
  ];
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
