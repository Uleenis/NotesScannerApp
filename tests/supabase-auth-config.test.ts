import * as ts from "typescript";

const root = ts.sys.getCurrentDirectory();
const config = ts.sys.readFile(`${root}/supabase/config.toml`) ?? "";

function section(name: string): Record<string, string> {
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start === -1) {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    if (text.startsWith("[")) {
      break;
    }
    const match = /^([A-Za-z_]+)\s*=\s*(.+)$/.exec(text);
    if (match) {
      values[match[1]] = match[2].trim();
    }
  }
  return values;
}

test("sends a code of 6 digits", () => {
  expect(section("auth.email").otp_length).toBe("6");
});

test("the code is valid for 10 minutes", () => {
  expect(section("auth.email").otp_expiry).toBe("600");
});

test("a new code can be asked for after 30 seconds, and the server refuses sooner", () => {
  expect(section("auth.email").max_frequency).toBe('"30s"');
});

test("an e-mail address must be proven before an account keeps it", () => {
  expect(section("auth.email").enable_confirmations).toBe("true");
});

test.each([
  ["email_change", "email-change.html"],
  ["magic_link", "magic-link.html"],
  ["confirmation", "confirmation.html"],
])("the %s e-mail shows the code and no link", (name, file) => {
  const template = section(`auth.email.template.${name}`);
  expect(template.content_path).toBe(`"./supabase/templates/${file}"`);
  expect(template.subject).toBeDefined();
  const path = `${root}/supabase/templates/${file}`;
  expect(ts.sys.fileExists(path)).toBe(true);
  const html = ts.sys.readFile(path) ?? "";
  expect(html).toContain("{{ .Token }}");
  expect(html).not.toContain("ConfirmationURL");
  expect(html).not.toContain("TokenHash");
  expect(html).not.toMatch(/href=/i);
});
