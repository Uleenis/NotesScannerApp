const { execSync } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");

const LOCAL_HOSTS = ["127.0.0.1", "localhost"];
const TABLES = [
  ["profiles", "id"],
  ["notebooks", "user_id"],
  ["chapters", "user_id"],
  ["pages", "user_id"],
  ["page_images", "user_id"],
  ["readings", "user_id"],
  ["page_texts", "user_id"],
  ["page_charges", "user_id"],
];

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

const status = localStatus();
const API = status.API_URL;
const MAIL = status.MAILPIT_URL;

if (!LOCAL_HOSTS.includes(new URL(API).hostname)) {
  console.error(`Refused: ${API} is not a local address.`);
  process.exit(1);
}

const options = () => ({ auth: { persistSession: false, autoRefreshToken: false } });
const visitor = () => createClient(API, status.PUBLISHABLE_KEY, options());
const server = createClient(API, status.SECRET_KEY, options());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

function check(label, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} - ${label}${condition ? "" : ` ${detail}`}`);
  if (!condition) failures += 1;
}

async function codeSentTo(address, notBefore = []) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(500);
    const list = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const mine = list.messages.filter((message) => message.To.some((to) => to.Address === address));
    for (const message of mine.sort((a, b) => (a.Created < b.Created ? 1 : -1))) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${message.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(full.Text)?.[1];
      if (code && !notBefore.includes(code)) return { code, subject: full.Subject, text: full.Text, html: full.HTML };
    }
  }
  return null;
}

async function clearMailbox(addresses) {
  const list = await (await fetch(`${MAIL}/api/v1/messages`)).json();
  const ids = list.messages.filter((message) => message.To.some((to) => addresses.includes(to.Address))).map((message) => message.ID);
  if (ids.length > 0) {
    await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: ids }) });
  }
}

async function rowsOf(userId) {
  let total = 0;
  for (const [table, column] of TABLES) {
    const { count, error } = await server.from(table).select("*", { count: "exact", head: true }).eq(column, userId);
    if (error) throw new Error(`${table}: ${error.message}`);
    total += count;
  }
  return total;
}

async function filesOf(userId) {
  const { data, error } = await server.storage.from("photos").list(userId, { limit: 100 });
  if (error) throw new Error(error.message);
  let count = 0;
  for (const entry of data) {
    const inner = await server.storage.from("photos").list(`${userId}/${entry.name}`, { limit: 100 });
    count += inner.data.length;
  }
  return count;
}

async function anonymousWithOnePage(client) {
  const { data } = await client.auth.signInAnonymously();
  const userId = data.user.id;
  const notebook = await client.from("notebooks").insert({ name: `Account flows ${Date.now()}` }).select("id").single();
  const page = await client.from("pages").insert({ notebook_id: notebook.data.id }).select("id").single();
  await client.from("pages").update({ uploaded_at: new Date().toISOString() }).eq("id", page.data.id);
  const charge = await server.rpc("charge_page", { p_page_id: page.data.id });
  const path = `${userId}/${page.data.id}/original.jpg`;
  const upload = await server.storage.from("photos").upload(path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { contentType: "image/jpeg" });
  if (notebook.error || page.error || charge.error || upload.error) throw new Error("could not prepare the account");
  return { userId, pageId: page.data.id, path };
}

async function register(client, address) {
  const asked = await client.auth.updateUser({ email: address });
  if (asked.error) throw new Error(`updateUser: ${asked.error.message}`);
  const mail = await codeSentTo(address);
  const verified = await client.auth.verifyOtp({ email: address, token: mail.code, type: "email_change" });
  if (verified.error) throw new Error(`verifyOtp: ${verified.error.message}`);
  return { mail, user: verified.data.user };
}

async function callDelete(token) {
  const response = await fetch(`${status.FUNCTIONS_URL}/delete-account`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

(async () => {
  const stamp = Date.now();
  const emailA = `flows-a-${stamp}@example.test`;
  const emailB = `flows-b-${stamp}@example.test`;
  const emailNobody = `flows-nobody-${stamp}@example.test`;

  console.log("Sign-up of an anonymous account that has a page");
  const phoneA = visitor();
  const a = await anonymousWithOnePage(phoneA);
  const before = (await server.rpc("page_allowance", { p_user_id: a.userId })).data[0];
  check("the anonymous account has one page charged", before.is_anonymous === true && before.used === 1, JSON.stringify(before));

  const asked = await phoneA.auth.updateUser({ email: emailA });
  check("asking for a code is accepted", !asked.error, asked.error?.message);
  const pending = (await phoneA.auth.getUser()).data.user;
  check("the address is not kept before the code is given", pending.is_anonymous === true && !pending.email, JSON.stringify({ anon: pending.is_anonymous, email: pending.email }));
  const mail = await codeSentTo(emailA);
  check("one e-mail arrived, with a 6-digit code", mail !== null && /^\d{6}$/.test(mail.code));
  check("the e-mail has no link", mail !== null && !/href=|https?:\/\//i.test(mail.text + mail.html), mail?.text);

  const again = await phoneA.auth.updateUser({ email: emailA });
  check("a second code is refused before 30 seconds", again.error?.code === "over_email_send_rate_limit", JSON.stringify(again.error));

  const wrong = await phoneA.auth.verifyOtp({ email: emailA, token: mail.code === "000000" ? "111111" : "000000", type: "email_change" });
  check("a wrong code is refused", wrong.error?.code === "otp_expired", JSON.stringify(wrong.error));

  const right = await phoneA.auth.verifyOtp({ email: emailA, token: mail.code, type: "email_change" });
  check("the right code is accepted", !right.error, right.error?.message);
  check("the account keeps its identifier and is no longer anonymous", right.data.user?.id === a.userId && right.data.user?.is_anonymous === false, JSON.stringify({ same: right.data.user?.id === a.userId, anon: right.data.user?.is_anonymous }));
  const seen = await phoneA.from("pages").select("id").eq("id", a.pageId);
  check("the page taken as anonymous is still readable", seen.data?.length === 1);
  const after = (await server.rpc("page_allowance", { p_user_id: a.userId })).data[0];
  check("the charge follows: 1 of 15", after.is_anonymous === false && after.used === 1 && after.max === 15, JSON.stringify(after));
  const mine = await phoneA.rpc("my_page_allowance");
  check("the app sees the same allowance", mine.data?.[0]?.is_anonymous === false && mine.data?.[0]?.used === 1);

  console.log("Address already taken, unknown address");
  const taker = visitor();
  await taker.auth.signInAnonymously();
  const taken = await taker.auth.updateUser({ email: emailA });
  check("an address that has an account is refused at sign-up", taken.error?.code === "email_exists", JSON.stringify(taken.error));
  await taker.auth.signOut({ scope: "local" });
  const stranger = await visitor().auth.signInWithOtp({ email: emailNobody, options: { shouldCreateUser: false } });
  check("a sign-in to an address without an account is refused", stranger.error?.code === "otp_disabled", JSON.stringify(stranger.error));

  console.log("Sign-in from a fresh anonymous phone, with a second registered account");
  const phoneB = visitor();
  const b = await anonymousWithOnePage(phoneB);
  await register(phoneB, emailB);

  const fresh = visitor();
  const emptyPhone = await fresh.auth.signInAnonymously();
  check("a fresh anonymous account has no page", ((await fresh.from("pages").select("id")).data ?? []).length === 0);
  const otp = await fresh.auth.signInWithOtp({ email: emailA, options: { shouldCreateUser: false } });
  check("a sign-in code is sent to an existing account", !otp.error, otp.error?.message);
  const signInMail = await codeSentTo(emailA, [mail.code]);
  check("the sign-in e-mail has a 6-digit code and no link", signInMail !== null && !/href=|https?:\/\//i.test(signInMail.text + signInMail.html));
  const signedIn = await fresh.auth.verifyOtp({ email: emailA, token: signInMail.code, type: "email" });
  check("the code opens the existing account", signedIn.data?.user?.id === a.userId, signedIn.error?.message);
  check("the anonymous account left behind is a different one", emptyPhone.data.user.id !== a.userId);
  check("the existing account's page is there", ((await fresh.from("pages").select("id")).data ?? []).some((row) => row.id === a.pageId));
  const tooSoon = await visitor().auth.signInWithOtp({ email: emailA, options: { shouldCreateUser: false } });
  check("a new sign-in code is refused before 30 seconds", tooSoon.error?.code === "over_email_send_rate_limit", JSON.stringify(tooSoon.error));

  console.log("Deletion of the account");
  check("account A has rows and a file before the deletion", (await rowsOf(a.userId)) > 0 && (await filesOf(a.userId)) === 1);
  const sessionA = (await fresh.auth.getSession()).data.session;
  const forged = await callDelete("forged-token");
  check("a forged token is refused", forged.status === 401, JSON.stringify(forged));
  check("nothing was deleted by the refusal", (await rowsOf(a.userId)) > 0);
  const deleted = await callDelete(sessionA.access_token);
  check("the function answers 200 deleted", deleted.status === 200 && deleted.body?.deleted === true, JSON.stringify(deleted));
  check("every row of account A is gone", (await rowsOf(a.userId)) === 0);
  check("every file of account A is gone", (await filesOf(a.userId)) === 0);
  check("the account itself is gone", (await server.auth.admin.getUserById(a.userId)).error !== null);
  check("account B keeps its rows and its file", (await rowsOf(b.userId)) > 0 && (await filesOf(b.userId)) === 1);
  const replay = await callDelete(sessionA.access_token);
  check("the token of a deleted account is refused", replay.status === 401, JSON.stringify(replay));

  const sessionB = (await phoneB.auth.getSession()).data.session;
  const deletedB = await callDelete(sessionB.access_token);
  check("account B can be deleted in its turn", deletedB.status === 200 && (await rowsOf(b.userId)) === 0 && (await filesOf(b.userId)) === 0, JSON.stringify(deletedB));

  const leftovers = [emptyPhone.data.user.id];
  for (const id of leftovers) await server.auth.admin.deleteUser(id);
  await clearMailbox([emailA, emailB, emailNobody]);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("The script stopped:", error.message);
  process.exit(1);
});
