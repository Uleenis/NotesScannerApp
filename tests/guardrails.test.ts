import * as ts from "typescript";
import { GUARDED_PATHS } from "../scripts/merge-gate";

type Settings = { permissions: { deny: string[] } };

type ChildProcess = {
  spawnSync: (
    command: string,
    args: string[],
    options: { input: string; encoding: "utf8" },
  ) => { status: number | null; stderr: string };
};

const { spawnSync } = jest.requireActual<ChildProcess>("child_process");

function read(path: string): string {
  const text = ts.sys.readFile(`${ts.sys.getCurrentDirectory()}/${path}`);
  if (text === undefined) throw new Error(`${path} is missing`);
  return text;
}

const SHELL_RULES = [
  "*gh pr merge*",
  "*gh.exe *merge*",
  "*gh pr -* merge*",
  "*gh -R *merge*",
  "*gh --repo *merge*",
  "*gh api*",
  "*gh alias*",
  "*gh auth*",
  "*gh extension*",
  "*gh secret*",
  "*gh variable*",
  "*gh workflow*",
  "*gh ruleset*",
  "*gh repo edit*",
  "*gh repo delete*",
  "*gh repo rename*",
  "*gh repo archive*",
  "git push",
  "*push*--fo*",
  "*push* -f*",
  "*push* +*",
  "*push*--mir*",
  "*push*--al*",
  "*push*--del*",
  "*push* -d *",
  "*push* :*",
  "*--no-v*",
  "*hooksPath*",
  "*hookspath*",
  "*HooksPath*",
  "*Hookspath*",
  "*HOOKSPATH*",
  "*git config*",
  "*git* -c *",
  "*GIT_CONFIG*",
  "*git credential*",
  "*git-credential*",
  "*Get-StoredCredential*",
  "*CredentialManager*",
  "*cmdkey*",
  "*functions/.env*",
  "*functions\\.env*",
  "*reading/.env*",
  "*reading\\.env*",
  "*docker*inspect*",
  "*docker*exec*",
  "*compose*config*",
  "*supabase* db* push*",
  "*--linked*",
  "*--db-url*",
  "*supabase* link*",
  "*supabase* login*",
  "*supabase* logout*",
  "*supabase* secrets*",
  "*supabase* migration* repair*",
  "*supabase* config* push*",
  "*supabase* projects*",
  "*supabase* orgs*",
  "*supabase* branches*",
  "*supabase* functions* deploy*",
  "*supabase* functions* delete*",
  "*supabase* storage *",
  "*supabase* sso*",
  "*supabase* domains*",
  "*supabase* vanity-subdomains*",
  "*supabase* network-*",
  "*supabase* ssl-enforcement*",
  "*supabase* postgres-config*",
  "*supabase* encryption*",
  "*supabase* backups*",
  "*gcloud*",
];

const GUARDED_FILES = [
  "./.claude/**",
  "./.githooks/**",
  "./.github/**",
  "./scripts/**",
  "./tests/merge-gate.test.ts",
  "./tests/guardrails.test.ts",
  "./.gitleaks.toml",
  "./.gitleaksignore",
];

const SECRET_FILES = [
  "./supabase/functions/.env",
  "./services/reading/.env",
];

const DENIED_TOOLS = [
  "mcp__claude-in-chrome",
  "mcp__computer-use",
  "mcp__ccd_pr__set_auto_merge",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__apply_migration",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__execute_sql",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__deploy_edge_function",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__create_edge_function_secret",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__create_project",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__pause_project",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__restore_project",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__create_branch",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__delete_branch",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__merge_branch",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__rebase_branch",
  "mcp__a3e7eef8-d7f2-46d3-b074-508b9d4cff18__reset_branch",
  "mcp__plugin_expo_expo__build_run",
  "mcp__plugin_expo_expo__build_submit",
  "mcp__plugin_expo_expo__build_cancel",
  "mcp__plugin_expo_expo__workflow_run",
  "mcp__plugin_expo_expo__workflow_create",
  "mcp__plugin_expo_expo__workflow_cancel",
  "mcp__plugin_expo_expo__appstore_reply_review",
  "mcp__plugin_expo_expo__appstore_delete_review_response",
  "mcp__plugin_expo_expo__playstore_reply_review",
  "mcp__plugin_expo_expo__usage_budget_create",
];

const deny = (JSON.parse(read(".claude/settings.json")) as Settings).permissions.deny;
const shellDeny = deny.filter((rule) => rule.startsWith("Bash(")).map((rule) => rule.slice(5, -1));

function denied(command: string): boolean {
  return shellDeny.some((pattern) => {
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`, "s").test(command);
  });
}

describe("guardrails", () => {
  it("denies exactly the expected rules, the same in both shells", () => {
    const expected = [
      ...SHELL_RULES.map((rule) => `Bash(${rule})`),
      ...SHELL_RULES.map((rule) => `PowerShell(${rule})`),
      ...GUARDED_FILES.flatMap((path) => [`Edit(${path})`, `Write(${path})`]),
      ...SECRET_FILES.map((path) => `Read(${path})`),
      ...DENIED_TOOLS,
    ];
    expect([...deny].sort()).toEqual([...expected].sort());
  });

  it("guards in the merge gate the same files it denies to edit", () => {
    const fromSettings = GUARDED_FILES.map((path) => path.slice(2).replace(/\*\*$/, ""));
    expect([...GUARDED_PATHS].sort()).toEqual([...fromSettings].sort());
  });

  it.each([
    "node scripts/merge-pr.mjs 23",
    "node scripts/deploy-function.mjs read-page",
    "git push -u origin t2/domain-model",
    "git push origin t2/fix-reading",
    "npx supabase start",
    "npx supabase db reset",
    "npx supabase test db",
    "npm run db:test",
    "gh pr create --title Add --body-file body.md",
    "gh pr view 23",
    "gh pr checks 23",
    "gh run list --limit 5",
    "git log -- supabase/functions",
    "cat supabase/functions/read-page/index.ts",
    "grep -rn supabase src/lib/secure-session-storage.ts src/lib/legal-links.ts",
    "git commit -m \"Add the reading service\"",
    "git commit -m \"Let the merge happen through the gate\"",
    "git commit -m \"Handle expired credentials\"",
    "gh pr create --title Add --body \"Users can merge their accounts.\"",
    "gh pr view 23 --json mergeable",
    "git rev-parse --git-path hooks",
    "git checkout -b t2/service",
    "npm run service:start",
    "npm run service:test",
    "docker compose -f services/reading/compose.yaml down",
    "docker logs notes-reading",
    "cat services/reading/src/reading/app.py",
    "git add services/reading/pyproject.toml services/reading/uv.lock",
  ])("still allows %s", (command) => {
    expect(denied(command)).toBe(false);
  });

  it.each([
    "gh pr merge 23",
    "gh pr --repo Uleenis/NotesScannerApp merge 23",
    "gh.exe pr merge 23",
    "cmd /c gh pr merge 23",
    "gh api -X PATCH repos/Uleenis/NotesScannerApp/git/refs/heads/main -f sha=abc",
    "gh api graphql -F query=@merge.graphql",
    "gh alias set m \"pr merge\"",
    "gh auth token",
    "gh secret set KEY",
    "gh workflow disable Checks",
    "gh repo edit --visibility public",
    "git push",
    "git push --force origin t2/x",
    "git push origin +t2/x",
    "git push --mirror",
    "git push --all origin",
    "git push origin --delete t2/x",
    "git push origin :t2/x",
    "gh -R Uleenis/NotesScannerApp pr merge 23",
    "git push --no-verify origin t2/x",
    "git push --no-verif origin main",
    "git push --fo origin t2/x",
    "git push --mir",
    "git -c core.hooksPath=/dev/null push origin HEAD:main",
    "git -c core.hookspath=/dev/null push origin HEAD:main",
    "git config core.hooksPath .git/hooks",
    "git config core.HOOKSPATH .git/hooks",
    "git config --unset core.hooksPath",
    "GIT_CONFIG_GLOBAL=x git push origin HEAD:main",
    "git credential fill",
    "cat supabase/functions/.env",
    "Get-Content supabase\\functions\\.env",
    "cat services/reading/.env",
    "Get-Content services\\reading\\.env",
    "docker run --env-file services/reading/.env notes-reading:local env",
    "docker inspect notes-reading",
    "docker container inspect notes-reading",
    "docker exec notes-reading env",
    "docker compose -f services/reading/compose.yaml config",
    "npx supabase db push",
    "npx supabase --debug db push",
    "npx supabase@latest link --project-ref abc",
    "npx supabase --debug secrets set KEY=value",
    "npx supabase projects delete abc",
    "npx supabase functions deploy read-page --project-ref abc",
    "npx supabase --debug functions deploy read-page --no-verify-jwt",
    "npx supabase functions delete read-page",
    "npx supabase db reset --linked",
    "npx supabase db dump --db-url postgres://x",
    "npx supabase login",
    "gcloud run deploy reading --image x",
    "gcloud --quiet iam service-accounts create x",
  ])("denies %s", (command) => {
    expect(denied(command)).toBe(true);
  });

  it.each([
    ["code-reviewer", "sonnet"],
    ["security-reviewer", "opus"],
  ])("defines the %s subagent on %s, without edit tools", (name, model) => {
    const definition = read(`.claude/agents/${name}.md`);
    expect(definition).toMatch(new RegExp(`^model: ${model}$`, "m"));
    expect(definition).toMatch(/^effort: high$/m);
    expect(definition).toMatch(/^tools: Read, Grep, Glob, Bash$/m);
  });

  it("judges a pull request with the gate of main, not with the gate of the branch", () => {
    const script = read("scripts/merge-pr.mjs");
    expect(script).toContain('"origin/main:scripts/merge-gate.ts"');
    expect(script).not.toMatch(/from "\.\/merge-gate\.ts"/);
    expect(script.indexOf("mergeRefusals(")).toBeLessThan(script.indexOf("mergeArguments("));
  });

  it.each([
    ["refs/heads/t2/x abc refs/heads/t2/x def", 0],
    ["refs/heads/t2/x abc refs/heads/main def", 1],
    ["HEAD abc refs/heads/main 0000000000000000000000000000000000000000", 1],
    ["(delete) 0000000000000000000000000000000000000000 refs/heads/t2/x def", 1],
    ["", 0],
  ])("the pre-push hook answers %j with %i", (line, status) => {
    const result = spawnSync("node", [".githooks/pre-push"], { input: `${line}\n`, encoding: "utf8" });
    expect(result.status).toBe(status);
  });
});
