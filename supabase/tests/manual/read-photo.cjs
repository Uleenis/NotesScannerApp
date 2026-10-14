const { readFileSync } = require("node:fs");
const { createClient } = require("@supabase/supabase-js");
const { adminOf, flag, localStatus, report } = require("./reading-report.cjs");

const NOTEBOOK_NAME = "Essai lecture A";
const WAIT_FOR_A_MS = 360_000;
const POLL_MS = 2_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const photoPath = flag("--photo");
  if (photoPath === null) {
    console.error("Usage: node supabase/tests/manual/read-photo.cjs --photo <a JPEG file>");
    process.exit(1);
  }
  const photo = readFileSync(photoPath);
  const env = localStatus();
  const admin = adminOf(env);

  const visitor = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
  const signedIn = await visitor.auth.signInAnonymously();
  if (signedIn.error) {
    throw signedIn.error;
  }
  const userId = signedIn.data.user.id;
  const token = signedIn.data.session.access_token;
  console.log("Account:", userId);

  const notebook = await admin.from("notebooks").insert({ user_id: userId, name: NOTEBOOK_NAME, position: 0 }).select("id").single();
  if (notebook.error) {
    throw notebook.error;
  }
  const now = new Date().toISOString();
  const page = await admin
    .from("pages")
    .insert({ user_id: userId, notebook_id: notebook.data.id, source: "camera", captured_at: now, uploaded_at: now })
    .select("id")
    .single();
  if (page.error) {
    throw page.error;
  }
  const pageId = page.data.id;
  const stored = await admin.storage.from("photos").upload(`${userId}/${pageId}/original.jpg`, photo, { contentType: "image/jpeg" });
  if (stored.error) {
    throw stored.error;
  }
  console.log("Page:", pageId);

  const started = Date.now();
  const response = await fetch(`${env.API_URL}/functions/v1/read-page`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, apikey: env.ANON_KEY },
    body: JSON.stringify({ page_id: pageId }),
  });
  const answer = await response.json();
  console.log(`read-page answered ${response.status} ${JSON.stringify(answer)} after ${Date.now() - started} ms`);
  if (answer.status !== "read") {
    process.exit(1);
  }

  const [read] = await report(admin, { pageId });
  if (read.type !== "text") {
    console.table([read]);
    return;
  }
  for (;;) {
    const [line] = await report(admin, { pageId });
    if (line.a !== "no" || Date.now() - started > WAIT_FOR_A_MS) {
      console.log(`A ${line.a === "no" ? "not written" : "written"} after ${Date.now() - started} ms`);
      console.table([line]);
      return;
    }
    await sleep(POLL_MS);
  }
}

main().catch((error) => {
  console.error("Failed:", error.message ?? error);
  process.exit(1);
});
