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

  it("refuses when a required check has not run, even if the others are green", () => {
    const checks = green.filter((check) => check.name !== "database");
    expect(mergeRefusals(ready, checks, files, true)).toEqual(['required check "database" has not run on the last commit']);
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
    "package.json",
    "audit-ci.json",
    ".nvmrc",
    ".gitignore",
    ".gitattributes",
  ])("leaves a pull request that changes %s to the owner", (path) => {
    expect(mergeRefusals(ready, green, [...files, path], true)).toEqual([
      `the pull request changes guarded files, which the owner merges: ${path}`,
    ]);
  });

  it("does not mistake a file that only starts like a guarded one", () => {
    expect(mergeRefusals(ready, green, ["package.json.md", "scriptsdoc.md", "tests/gates-other.test.ts"], true)).toEqual([]);
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
