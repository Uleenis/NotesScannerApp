const { execSync } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");

const LOCAL_HOSTS = ["127.0.0.1", "localhost"];
const DEFAULT_PAGES = 10;

function flag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function localStatus() {
  const lines = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .split("\n")
    .filter((line) => line.includes("="));
  const env = Object.fromEntries(
    lines.map((line) => {
      const [key, ...rest] = line.split("=");
      return [key, rest.join("=").replace(/^"|"$/g, "")];
    }),
  );
  if (!LOCAL_HOSTS.includes(new URL(env.API_URL).hostname)) {
    console.error("Refused: this script only works on the local Supabase stack.");
    process.exit(1);
  }
  return env;
}

function adminOf(env) {
  return createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function rows(query) {
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data;
}

async function report(admin, filter) {
  let pagesQuery = admin
    .from("pages")
    .select("id, user_id, status, page_type, language, read_at")
    .not("uploaded_at", "is", null)
    .order("uploaded_at", { ascending: false })
    .limit(filter.limit ?? DEFAULT_PAGES);
  if (filter.pageId) pagesQuery = pagesQuery.eq("id", filter.pageId);
  if (filter.userId) pagesQuery = pagesQuery.eq("user_id", filter.userId);
  const pages = await rows(pagesQuery);
  const lines = [];
  for (const page of pages) {
    const readings = await rows(admin.from("readings").select("label, duration_ms, alto_path").eq("page_id", page.id));
    const a = readings.find((reading) => reading.label === "A");
    const count = async (kind) => {
      let query = admin.from("page_tokens").select("token_index", { count: "exact", head: true }).eq("page_id", page.id);
      query = kind === undefined ? query : kind === null ? query.is("anchor_kind", null) : query.eq("anchor_kind", kind);
      const { count: found, error } = await query;
      if (error) {
        throw error;
      }
      return found ?? 0;
    };
    lines.push({
      page: page.id,
      status: page.status,
      type: page.page_type,
      language: page.language ?? "-",
      b1: readings.some((reading) => reading.label === "B1") ? "yes" : "no",
      a: a ? `yes (${a.duration_ms} ms)` : "no",
      alto: a?.alto_path ? "yes" : "no",
      tokens: await count(undefined),
      word: await count("word"),
      line: await count("line"),
      none: await count(null),
    });
  }
  return lines;
}

async function main() {
  const env = localStatus();
  const lines = await report(adminOf(env), { pageId: flag("--page"), userId: flag("--user"), limit: Number(flag("--limit") ?? DEFAULT_PAGES) });
  if (lines.length === 0) {
    console.log("No uploaded page.");
    return;
  }
  console.table(lines);
}

module.exports = { adminOf, flag, localStatus, report };

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed:", error.message ?? error);
    process.exit(1);
  });
}
