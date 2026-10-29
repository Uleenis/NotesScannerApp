import * as ts from "typescript";

type ChildProcess = {
  execFileSync: (
    file: string,
    args: string[],
    options: { cwd: string; encoding: "utf8"; maxBuffer: number },
  ) => string;
};

const root = ts.sys.getCurrentDirectory();
const { execFileSync } = jest.requireActual<ChildProcess>("child_process");

const BINARY = /\.(png|jpe?g|gif|webp|ico|ttf|otf|woff2?)$/i;

const PATTERNS: [string, RegExp][] = [
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["Google key of the AQ. format", /(?<![0-9A-Za-z])AQ\.[0-9A-Za-z_-]{20,}/],
  ["Google OAuth client secret", /GOCSPX-[0-9A-Za-z_-]{10,}/],
  ["Google service account", /gserviceaccount\.com|"type"\s*:\s*"service_account"/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

function filesGoingToGitHub(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file !== "" && !BINARY.test(file));
}

function findings(): string[] {
  return filesGoingToGitHub().flatMap((file) =>
    (ts.sys.readFile(`${root}/${file}`) ?? "")
      .split(/\r?\n/)
      .flatMap((line, index) =>
        PATTERNS.filter(([, pattern]) => pattern.test(line)).map(([name]) => `${file}:${index + 1} ${name}`),
      ),
  );
}

test("the scan covers the files that go to GitHub", () => {
  expect(filesGoingToGitHub()).toEqual(
    expect.arrayContaining(["package.json", "src/lib/supabase.ts", "supabase/config.toml", "tests/google-keys.test.ts"]),
  );
});

test("the scan leaves out the files git ignores, where local secrets live", () => {
  const envFiles = filesGoingToGitHub().filter((file) => /(^|\/)\.env(\.|$)/.test(file));
  expect(envFiles).toEqual([".env.example", "services/reading/.env.example", "services/training/.env.example"]);
});

test("no Google key or identifier is in the files that go to GitHub", () => {
  expect(findings()).toEqual([]);
});
