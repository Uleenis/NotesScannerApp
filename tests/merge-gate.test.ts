import * as ts from "typescript";
import {
  Check,
  DeployState,
  PRODUCTION_REF,
  PullRequest,
  REQUIRED_CHECKS,
  REVIEW_HEADING,
  deployArguments,
  deployRefusals,
  mergeArguments,
  mergeRefusals,
  lockRefusals,
  packageRefusals,
} from "../scripts/merge-gate";

const ready: PullRequest = {
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "t2/service",
  mergeable: "MERGEABLE",
  body: `What it does\n\n${REVIEW_HEADING}\n\n- nothing found`,
};

const green: Check[] = REQUIRED_CHECKS.map((name) => ({ name, bucket: "pass" }));

const files = ["services/reading/main.py", "tests/reading.test.ts"];

function ciJobs(): string[] {
  const workflow = ts.sys.readFile(`${ts.sys.getCurrentDirectory()}/.github/workflows/checks.yml`);
  if (workflow === undefined) throw new Error("the CI workflow is missing");
  const jobs = workflow.replace(/\r\n/g, "\n").split("\njobs:\n")[1] ?? "";
  return [...jobs.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1]);
}

describe("REQUIRED_CHECKS", () => {
  it("requires the five checks of CI, the reading service included", () => {
    expect([...REQUIRED_CHECKS].sort()).toEqual(["app", "database", "functions", "reading", "secrets"]);
  });

  it("requires every job of the CI workflow, and only those", () => {
    expect([...ciJobs()].sort()).toEqual([...REQUIRED_CHECKS].sort());
  });
});

describe("mergeRefusals", () => {
  it("lets an open pull request with every required check green and a review section through", () => {
    expect(mergeRefusals(ready, green, files, true)).toEqual([]);
  });

  it("accepts a description written with Windows line endings", () => {
    expect(mergeRefusals({ ...ready, body: `Text\r\n${REVIEW_HEADING}\r\n- none` }, green, files, true)).toEqual([]);
  });

  it.each(["fail", "pending", "cancel", "skipping"])("refuses while a required check is %s", (bucket) => {
    const checks = green.map((check) => (check.name === "database" ? { ...check, bucket } : check));
    expect(mergeRefusals(ready, checks, files, true)).toEqual([`required check "database" is ${bucket}`]);
  });

  it("refuses while the reading service has not passed, even if the four others are green", () => {
    const others = green.filter((check) => check.name !== "reading");
    expect(mergeRefusals(ready, others, files, true)).toEqual(['required check "reading" has not run on the last commit']);
    expect(mergeRefusals(ready, [...others, { name: "reading", bucket: "fail" }], files, true)).toEqual([
      'required check "reading" is fail',
    ]);
  });

  it("refuses when a required check has not run, even if the others are green", () => {
    const checks = green.filter((check) => check.name !== "database");
    expect(mergeRefusals(ready, checks, files, true)).toEqual(['required check "database" has not run on the last commit']);
  });

  it("refuses when an earlier run of a required check passed but a later one failed", () => {
    expect(mergeRefusals(ready, [...green, { name: "app", bucket: "fail" }], files, true)).toEqual([
      'required check "app" is fail',
    ]);
  });

  it("refuses when no check has run", () => {
    expect(mergeRefusals(ready, [], files, true)).toHaveLength(REQUIRED_CHECKS.length);
  });

  it("refuses while an extra check fails, and ignores an extra check that is skipped", () => {
    expect(mergeRefusals(ready, [...green, { name: "dependabot", bucket: "skipping" }], files, true)).toEqual([]);
    expect(mergeRefusals(ready, [...green, { name: "dependabot", bucket: "fail" }], files, true)).toEqual([
      'check "dependabot" is fail',
    ]);
  });

  it.each(["Review done", `${REVIEW_HEADING}s`, `#${REVIEW_HEADING}`, `see ${REVIEW_HEADING}`, `    ${REVIEW_HEADING}`])(
    "refuses a description whose only review line is %j",
    (line) => {
      expect(mergeRefusals({ ...ready, body: `Text\n${line}\n- none` }, green, files, true)).toEqual([
        `the description has no "${REVIEW_HEADING}" line`,
      ]);
    },
  );

  it("refuses a branch that does not contain the last commit of main", () => {
    expect(mergeRefusals(ready, green, files, false)).toEqual([
      "the branch does not contain the last commit of main: CI did not test what would be merged",
    ]);
  });

  it.each([
    ".github/workflows/checks.yml",
    ".claude/settings.json",
    ".githooks/pre-push",
    "scripts/merge-gate.ts",
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
    "Scripts/merge-gate.ts",
    ".Claude/settings.json",
  ])("leaves a pull request that changes %s to the owner", (path) => {
    expect(mergeRefusals(ready, green, [...files, path], true)).toEqual([
      `the pull request changes guarded files, which the owner merges: ${path}`,
    ]);
  });

  it("does not mistake a file that only starts like a guarded one", () => {
    expect(mergeRefusals(ready, green, ["package.json.md", "scriptsdoc.md", "tests/gates-other.test.ts"], true)).toEqual([]);
  });

  it.each(["package.json", "package-lock.json"])("leaves %s to its own checks", (path) => {
    expect(mergeRefusals(ready, green, [...files, path], true)).toEqual([]);
  });

  it("refuses a closed, draft, conflicting or misdirected pull request", () => {
    const refusals = mergeRefusals(
      { ...ready, state: "CLOSED", isDraft: true, baseRefName: "t2/service", headRefName: "main", mergeable: "CONFLICTING" },
      green,
      files,
      true,
    );
    expect(refusals).toEqual([
      "the pull request is closed, not open",
      "the pull request is a draft",
      "the pull request targets t2/service, not main",
      "the pull request comes from main",
      "GitHub reports the pull request as CONFLICTING, not mergeable",
    ]);
  });

  it("refuses while GitHub has not computed whether the pull request merges", () => {
    expect(mergeRefusals({ ...ready, mergeable: "UNKNOWN" }, green, files, true)).toEqual([
      "GitHub reports the pull request as UNKNOWN, not mergeable",
    ]);
  });
});

describe("packageRefusals", () => {
  const base = JSON.stringify({
    main: "expo-router/entry",
    dependencies: { a: "^1.0.0", expo: "~57.0.22" },
    devDependencies: { jest: "~29.7.0" },
    scripts: { test: "jest" },
    jest: { preset: "jest-expo" },
  });
  const withChange = (change: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(base), ...change });
  const unreadable = "package.json cannot be read on main or on the branch: the owner merges this pull request";

  it.each([
    ["a new version", { dependencies: { a: "^1.2.0", expo: "~57.0.22" } }],
    ["a new package", { dependencies: { a: "^1.0.0", b: "2.0.0", expo: "~57.0.22" } }],
    ["a removed package", { dependencies: { expo: "~57.0.22" } }],
    ["a prerelease", { dependencies: { a: "1.0.0-rc.1", expo: "~57.0.22" } }],
  ])("lets %s through", (_label, change) => {
    expect(packageRefusals(base, withChange(change))).toEqual([]);
  });

  it.each([
    ["scripts", { scripts: { test: "true" } }],
    ["jest", { jest: { preset: "jest-expo", testPathIgnorePatterns: ["/"] } }],
    ["babel", { babel: { plugins: ["./tools/x.js"] } }],
    ["overrides", { overrides: { "jest-cli": "github:x/y" } }],
    ["workspaces", { workspaces: ["tools/*"] }],
    ["main", { main: "index.js" }],
  ])("leaves a change of %s to the owner", (key, change) => {
    expect(packageRefusals(base, withChange(change))).toEqual([
      `the pull request changes "${key}" in package.json, which the owner merges`,
    ]);
  });

  it.each([
    ["expo", { dependencies: { a: "^1.0.0", expo: "~58.0.0" } }],
    ["jest", { devDependencies: { jest: "file:./tools/jest" } }],
    ["typescript", { devDependencies: { jest: "~29.7.0", typescript: "~6.0.3" } }],
  ])("leaves a change of %s, which runs or shapes the checks, to the owner", (name, change) => {
    expect(packageRefusals(base, withChange(change))).toEqual([
      `the pull request changes "${name}", which runs or shapes the checks: the owner merges it`,
    ]);
  });

  it.each([
    "file:./tools/b",
    "link:../b",
    "github:x/b",
    "git+https://x/b.git",
    "https://x/b.tgz",
    "npm:other@1.0.0",
    "workspace:*",
    "*",
    "latest",
    ">=1.0.0",
  ])("leaves a package from %s to the owner", (source) => {
    expect(packageRefusals(base, withChange({ dependencies: { a: "^1.0.0", b: source, expo: "~57.0.22" } }))).toEqual([
      'the pull request gives "b" a source other than a version of the npm registry: the owner merges it',
    ]);
  });

  it("leaves a list of packages that is not an object to the owner", () => {
    expect(packageRefusals(base, withChange({ devDependencies: ["jest"] }))).toEqual([
      '"devDependencies" of package.json is not a list of packages: the owner merges this pull request',
    ]);
  });

  it.each([
    ["missing on the branch", base, null],
    ["missing on main", null, base],
    ["not JSON", base, "{"],
    ["not an object", base, "[]"],
  ])("refuses a package.json %s", (_label, before, after) => {
    expect(packageRefusals(before, after)).toEqual([unreadable]);
  });
});

describe("lockRefusals", () => {
  const lock = (packages: Record<string, unknown>) =>
    JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "app" }, ...packages } });
  const fromRegistry = { resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz", integrity: "sha512-x" };
  const outside =
    "package-lock.json takes 1 package(s) from outside the npm registry, or without integrity: the owner merges this pull request";
  const unreadable = "package-lock.json cannot be read on the branch: the owner merges this pull request";

  it("lets packages of the npm registry with their integrity through", () => {
    expect(lockRefusals(lock({ "node_modules/a": fromRegistry, "node_modules/b": { version: "1.0.0" } }))).toEqual([]);
  });

  it.each([
    ["another host", { resolved: "https://evil.example/a.tgz", integrity: "sha512-x" }],
    ["plain http", { resolved: "http://registry.npmjs.org/a/-/a-1.0.0.tgz", integrity: "sha512-x" }],
    ["no integrity", { resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" }],
    ["a link", { link: true, resolved: "tools/jest" }],
    ["a git source", { resolved: "git+ssh://git@github.com/x/a.git#abc" }],
  ])("leaves a package from %s to the owner", (_label, entry) => {
    expect(lockRefusals(lock({ "node_modules/a": entry }))).toEqual([outside]);
  });

  it.each([null, "{", "[]", JSON.stringify({ packages: [] }), JSON.stringify({ lockfileVersion: 3 })])(
    "refuses an unreadable lock %j",
    (text) => {
      expect(lockRefusals(text)).toEqual([unreadable]);
    },
  );
});

describe("mergeArguments", () => {
  it("merges only the commit the gate checked", () => {
    expect(mergeArguments("23", "abc123")).toEqual(["pr", "merge", "23", "--merge", "--match-head-commit", "abc123"]);
  });
});

describe("deployRefusals", () => {
  const deployable: DeployState = {
    name: "read-page",
    functions: ["prepare-page", "read-page"],
    clean: true,
    head: "abc",
    main: "abc",
    runs: [{ status: "completed", conclusion: "success" }],
  };

  it("deploys a function from a clean copy of main whose CI is green", () => {
    expect(deployRefusals(deployable)).toEqual([]);
  });

  it("refuses an unknown function", () => {
    expect(deployRefusals({ ...deployable, name: "drop-everything" })).toEqual([
      '"drop-everything" is not an Edge Function of the repository',
    ]);
  });

  it("refuses local changes and a HEAD that is not main", () => {
    expect(deployRefusals({ ...deployable, clean: false, head: "def" })).toEqual([
      "the working tree has changes: only what is on main is deployed",
      "HEAD is not the last commit of main: only what is on main is deployed",
    ]);
  });

  it.each([
    [[], "CI has not run on the last commit of main"],
    [[{ status: "in_progress", conclusion: "" }], "CI on the last commit of main is in_progress"],
    [[{ status: "completed", conclusion: "failure" }], "CI on the last commit of main is completed failure"],
  ])("refuses while CI on main is not green (%j)", (runs, refusal) => {
    expect(deployRefusals({ ...deployable, runs })).toEqual([refusal]);
  });
});

describe("deployArguments", () => {
  it("deploys to production with the settings of the repository, never without the token check", () => {
    const args = deployArguments("read-page");
    expect(args).toEqual(["supabase", "functions", "deploy", "read-page", "--project-ref", PRODUCTION_REF]);
    expect(args).not.toContain("--no-verify-jwt");
  });
});
