const { execSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { createClient } = require("@supabase/supabase-js");

const NOTEBOOK_NAME = "Essai lecture";
const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

function flag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function localStatus() {
  const lines = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .split("\n")
    .filter((line) => line.includes("="));
  return Object.fromEntries(
    lines.map((line) => {
      const [key, ...rest] = line.split("=");
      return [key, rest.join("=").replace(/^"|"$/g, "")];
    }),
  );
}

const READ_TEXT = [
  "Le cycle de l'eau",
  "",
  "Évaporation -> l'eau des océans monte,",
  "puis se condense en nuages",
  "Précipitations: pluie, neige,",
  "grêle",
  "Ruissellement -> les rivières",
  "ramènent l'eau à la mer.",
  "a) première étape: $H_2O$ liquide",
  "b) deuxième étape",
  "- fin du cycle.",
].join("\n");

const LONG_TEXT = ["Journal de test", "", ...Array.from({ length: 40 }, (_, index) => `Ligne ${index + 1} de la page longue, pour faire défiler le texte.`)].join("\n");

async function main() {
  const photoPath = flag("--photo");
  if (photoPath === null) {
    console.error("Usage: node supabase/tests/manual/prepare-reading-screens.cjs --photo <a JPEG file> [--user <account id>] [--with-stuck] [--without-page-being-read]");
    process.exit(1);
  }
  const env = localStatus();
  const host = new URL(env.API_URL).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    console.error("Refused: this script only works on the local Supabase stack.");
    process.exit(1);
  }
  const photo = readFileSync(photoPath);
  const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  let userId = flag("--user");
  if (userId === null) {
    const listed = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listed.error) {
      throw listed.error;
    }
    const anonymous = listed.data.users.filter((user) => user.is_anonymous);
    if (anonymous.length === 0) {
      console.error("No anonymous account yet: open the app once on the phone, then run this again.");
      process.exit(1);
    }
    userId = anonymous[anonymous.length - 1].id;
  }
  console.log("Account:", userId);

  const existing = await admin.from("notebooks").select("id").eq("user_id", userId).eq("name", NOTEBOOK_NAME).maybeSingle();
  let notebookId = existing.data?.id;
  if (notebookId === undefined) {
    const created = await admin.from("notebooks").insert({ user_id: userId, name: NOTEBOOK_NAME, position: 99 }).select("id").single();
    if (created.error) {
      throw created.error;
    }
    notebookId = created.data.id;
  }

  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

  const fixtures = [
    { label: "read page", minutes: 240, row: { status: "read" }, text: READ_TEXT },
    { label: "long read page", minutes: 180, row: { status: "read" }, text: LONG_TEXT },
    { label: "page being read", minutes: 30, row: { status: "processing", attempted_at: minutesAgo(1) } },
    { label: "put-off reading (read_error)", minutes: 20, row: { status: "queued", queue_reason: "read_error", attempted_at: minutesAgo(3) } },
    { label: "failed reading", minutes: 10, row: { status: "failed", retry_count: 3 } },
  ];
  if (process.argv.includes("--without-page-being-read")) {
    fixtures.splice(fixtures.findIndex((fixture) => fixture.label === "page being read"), 1);
  }
  if (process.argv.includes("--with-stuck")) {
    fixtures.push({ label: "queued page nobody started (the screen will start a REAL reading)", minutes: 5, row: { status: "queued" } });
  }

  for (const fixture of fixtures) {
    const moment = minutesAgo(fixture.minutes);
    const created = await admin
      .from("pages")
      .insert({ user_id: userId, notebook_id: notebookId, source: "camera", captured_at: moment, uploaded_at: moment, ...fixture.row })
      .select("id")
      .single();
    if (created.error) {
      throw created.error;
    }
    const pageId = created.data.id;
    const stored = await admin.storage.from("photos").upload(`${userId}/${pageId}/original.jpg`, photo, { contentType: "image/jpeg", upsert: true });
    if (stored.error) {
      throw stored.error;
    }
    if (fixture.text !== undefined) {
      const written = await admin.from("page_texts").insert({ page_id: pageId, user_id: userId, text: fixture.text, pipeline_version: "b1-raw" });
      if (written.error) {
        throw written.error;
      }
    }
    console.log(`- ${fixture.label}: ${pageId}`);
  }
  console.log(`Done. Open the notebook "${NOTEBOOK_NAME}" in the app.`);
}

main().catch((error) => {
  console.error("Failed:", error.message ?? error);
  process.exit(1);
});
