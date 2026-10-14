const { execSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
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
  ["page_tokens", "user_id"],
  ["htr_models", "user_id"],
];

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

const status = localStatus();
const API = status.API_URL;
const MAIL = status.MAILPIT_URL;

if (!LOCAL_HOSTS.includes(new URL(API).hostname)) {
  console.error(`Refused: ${API} is not a local address.`);
  process.exit(1);
}

const options = () => ({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const visitor = () => createClient(API, status.PUBLISHABLE_KEY, options());
const server = createClient(API, status.SECRET_KEY, options());

function inMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const phone = () =>
  createClient(API, status.PUBLISHABLE_KEY, {
    auth: { storage: inMemoryStorage(), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const created = [];

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
      if (code && !notBefore.includes(code)) return code;
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

async function countOf(table, column, userId) {
  const { count, error } = await server.from(table).select("*", { count: "exact", head: true }).eq(column, userId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count;
}

async function rowsOf(userId) {
  let total = 0;
  for (const [table, column] of TABLES) total += await countOf(table, column, userId);
  return total;
}

async function filesOf(userId, bucket = "photos") {
  const found = [];
  const folders = [userId];
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await server.storage.from(bucket).list(folder, { limit: 100, offset });
      if (error) throw new Error(error.message);
      for (const entry of data) (entry.id === null ? folders : found).push(`${folder}/${entry.name}`);
      if (data.length < 100) break;
    }
  }
  return found;
}

async function registered(address) {
  const client = visitor();
  const { data } = await client.auth.signInAnonymously();
  created.push(data.user.id);
  const asked = await client.auth.updateUser({ email: address });
  if (asked.error) throw new Error(`updateUser: ${asked.error.message}`);
  const code = await codeSentTo(address);
  const verified = await client.auth.verifyOtp({ email: address, token: code, type: "email_change" });
  if (verified.error) throw new Error(`verifyOtp: ${verified.error.message}`);
  return data.user.id;
}

async function sessionFor(address, notBefore = []) {
  const stateless = visitor();
  const sent = await stateless.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } });
  if (sent.error) throw new Error(`signInWithOtp: ${sent.error.message}`);
  const code = await codeSentTo(address, notBefore);
  const verified = await stateless.auth.verifyOtp({ email: address, token: code, type: "email" });
  if (verified.error) throw new Error(`verifyOtp: ${verified.error.message}`);
  return { session: verified.data.session, code };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

async function addPage(userId, notebookId, withCharge) {
  const page = await server.from("pages").insert({ user_id: userId, notebook_id: notebookId, uploaded_at: new Date().toISOString() }).select("id").single();
  if (page.error) throw new Error(`page: ${page.error.message}`);
  const path = `${userId}/${page.data.id}/original.jpg`;
  const upload = await server.storage.from("photos").upload(path, JPEG, { contentType: "image/jpeg" });
  if (upload.error) throw new Error(`upload: ${upload.error.message}`);
  const image = await server.from("page_images").insert({ user_id: userId, page_id: page.data.id, kind: "original", storage_path: path });
  if (image.error) throw new Error(`image: ${image.error.message}`);
  await server.from("page_texts").insert({ user_id: userId, page_id: page.data.id, text: "Texte d'essai", pipeline_version: "1" });
  if (withCharge) {
    const charge = await server.rpc("charge_page", { p_page_id: page.data.id });
    if (charge.error || !charge.data?.[0]?.allowed) throw new Error("charge");
  }
  return { id: page.data.id, path };
}

const ALTO = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><alto/>');

async function addReadingA(userId, pageId) {
  const path = `${userId}/${pageId}/a.xml`;
  const upload = await server.storage.from("alto").upload(path, ALTO, { contentType: "application/xml" });
  if (upload.error) throw new Error(`alto: ${upload.error.message}`);
  const written = await server.rpc("record_reading_a", {
    p_page_id: pageId,
    p_user_id: userId,
    p_raw_text: "Texte",
    p_model: "medium",
    p_model_version: "manual",
    p_duration_ms: 1,
    p_alto_path: path,
    p_language: "fr",
    p_tokens: [{ token_index: 0, line_index: 0, text: "Texte", reading_a: "Texte", reading_b1: "Texte", anchor_kind: "word", anchor: [0, 0, 10, 10] }],
  });
  if (written.error || written.data?.[0]?.reason !== "recorded") throw new Error(`record_reading_a: ${written.error?.message ?? JSON.stringify(written.data)}`);
  return path;
}

async function notebook(userId, name) {
  const made = await server.from("notebooks").insert({ user_id: userId, name }).select("id").single();
  if (made.error) throw new Error(`notebook: ${made.error.message}`);
  return made.data.id;
}

async function callTransfer(headers, method = "POST", body = {}) {
  const response = await fetch(`${status.FUNCTIONS_URL}/transfer-account`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

(async () => {
  const logFile = flag("--log");
  const stamp = Date.now();
  const emailB = `transfer-b-${stamp}@example.test`;
  const emailC = `transfer-c-${stamp}@example.test`;
  const emailD = `transfer-d-${stamp}@example.test`;
  const sharedName = `Histoire ${stamp}`;
  const ownName = `Propre ${stamp}`;

  console.log("Accounts for the essay");
  const b = await registered(emailB);
  const c = await registered(emailC);
  const d = await registered(emailD);
  const bShared = await notebook(b, ` ${sharedName} `);
  const bPage = await addPage(b, bShared, true);
  const cNotebook = await notebook(c, "Carol");
  const cPage = await addPage(c, cNotebook, false);

  const main = phone();
  const anonymous = await main.auth.signInAnonymously();
  const a = anonymous.data.user.id;
  created.push(a);
  const aShared = await notebook(a, sharedName);
  const aOwn = await notebook(a, ownName);
  await server.from("chapters").insert({ user_id: a, notebook_id: aShared, name: "Chapitre" });
  const aPages = [await addPage(a, aShared, true), await addPage(a, aOwn, true)];
  await addReadingA(a, aPages[0].id);
  const before = (await server.rpc("page_allowance", { p_user_id: b })).data[0];
  check("the account found has used 1 page this month", before.used === 1 && before.is_anonymous === false, JSON.stringify(before));
  check("the anonymous account has 2 pages, 2 files and 2 charges", (await countOf("pages", "user_id", a)) === 2 && (await filesOf(a)).length === 2 && (await countOf("page_charges", "user_id", a)) === 2);

  console.log("The code of the account found is checked on a client that keeps nothing");
  const found = await sessionFor(emailB);
  check("the client of the phone is still the anonymous account", (await main.auth.getSession()).data.session.user.id === a);
  const anonymousToken = (await main.auth.getSession()).data.session.access_token;
  const foundToken = found.session.access_token;
  const other = await sessionFor(emailC);

  console.log("Refusals by the real function");
  const snapshot = async () => JSON.stringify([await rowsOf(a), (await filesOf(a)).length, await rowsOf(b), (await filesOf(b)).length, await rowsOf(c), (await filesOf(c)).length]);
  const beforeRefusals = await snapshot();
  const noToken = await callTransfer({});
  check("no token at all is refused", noToken.status === 401, JSON.stringify(noToken));
  const onlyAnonymous = await callTransfer({ authorization: `Bearer ${anonymousToken}` });
  check("the anonymous token alone is refused", onlyAnonymous.status === 401 && onlyAnonymous.body?.error === "unauthenticated", JSON.stringify(onlyAnonymous));
  const onlyAccount = await callTransfer({ authorization: `Bearer ${foundToken}` });
  check("the token of the account found alone is refused", onlyAccount.status === 401 && onlyAccount.body?.error === "unauthenticated", JSON.stringify(onlyAccount));
  const forgedFirst = await callTransfer({ authorization: "Bearer forged.token.value", "x-account-token": foundToken });
  check("a forged first token is refused", forgedFirst.status === 401, JSON.stringify(forgedFirst));
  const forgedSecond = await callTransfer({ authorization: `Bearer ${anonymousToken}`, "x-account-token": "forged.token.value" });
  check("a forged second token is refused", forgedSecond.status === 401 && forgedSecond.body?.error === "unauthenticated", JSON.stringify(forgedSecond));
  const same = await callTransfer({ authorization: `Bearer ${foundToken}`, "x-account-token": foundToken });
  check("two tokens of the same account are refused", same.status === 400 && same.body?.error === "same_account", JSON.stringify(same));
  const notAnonymous = await callTransfer({ authorization: `Bearer ${foundToken}`, "x-account-token": other.session.access_token });
  check("a first token that is not anonymous is refused", notAnonymous.status === 403 && notAnonymous.body?.error === "not_anonymous", JSON.stringify(notAnonymous));
  const secondAnonymous = visitor();
  const secondAnonymousUser = (await secondAnonymous.auth.signInAnonymously()).data;
  created.push(secondAnonymousUser.user.id);
  const toAnonymous = await callTransfer({ authorization: `Bearer ${anonymousToken}`, "x-account-token": secondAnonymousUser.session.access_token });
  check("a second token that is anonymous is refused", toAnonymous.status === 403 && toAnonymous.body?.error === "target_anonymous", JSON.stringify(toAnonymous));
  const wrongMethod = await callTransfer({ authorization: `Bearer ${anonymousToken}`, "x-account-token": foundToken }, "GET");
  check("a GET is refused", wrongMethod.status === 405, JSON.stringify(wrongMethod));
  await server.from("pages").update({ status: "processing" }).eq("id", aPages[0].id);
  const processing = await callTransfer({ authorization: `Bearer ${anonymousToken}`, "x-account-token": foundToken });
  check("a page being read stops the transfer", processing.status === 409 && processing.body?.error === "page_processing", JSON.stringify(processing));
  await server.from("pages").update({ status: "queued" }).eq("id", aPages[0].id);
  check("no refusal changed anything", (await snapshot()) === beforeRefusals);
  check("the account of the phone is still there", (await server.auth.admin.getUserById(a)).error === null);

  console.log("The transfer, called as the app calls it");
  const cBefore = [await rowsOf(c), (await filesOf(c)).length];
  const asked = await main.functions.invoke("transfer-account", {
    headers: { Authorization: `Bearer ${anonymousToken}`, "x-account-token": foundToken },
    body: { user_id: c, page_id: cPage.id, from: c, to: c },
  });
  check("the function answers transferred", !asked.error && asked.data?.transferred === true, JSON.stringify({ error: asked.error?.message, data: asked.data }));

  check("the account of the phone is gone", (await server.auth.admin.getUserById(a)).error !== null);
  check("no row is left for the account of the phone", (await rowsOf(a)) === 0);
  check("no file is left for the account of the phone", (await filesOf(a)).length === 0);
  check("the account found has its page and the two pages of the phone", (await countOf("pages", "user_id", b)) === 3);
  check("the notebooks of the same name are one", (await countOf("notebooks", "user_id", b)) === 2);
  const joined = await server.from("pages").select("notebook_id").in("id", [aPages[0].id]).single();
  check("the page of the phone is in the notebook that was already there", joined.data?.notebook_id === bShared, JSON.stringify(joined));
  check("the chapter followed", (await countOf("chapters", "user_id", b)) === 1);
  const images = (await server.from("page_images").select("storage_path").eq("user_id", b)).data.map((row) => row.storage_path).sort();
  const expectedPaths = [bPage.path, ...aPages.map((page) => `${b}/${page.id}/original.jpg`)].sort();
  check("the paths of the photos are those of the account found", JSON.stringify(images) === JSON.stringify(expectedPaths), JSON.stringify(images));
  check("the files of the account found are at those paths", JSON.stringify((await filesOf(b)).sort()) === JSON.stringify(expectedPaths));
  check("the texts and the charges moved", (await countOf("page_texts", "user_id", b)) === 3 && (await countOf("page_charges", "user_id", b)) === 3);
  const movedAlto = `${b}/${aPages[0].id}/a.xml`;
  check("no ALTO file is left for the account of the phone", (await filesOf(a, "alto")).length === 0);
  check("the ALTO file is at the path of the account found", JSON.stringify(await filesOf(b, "alto")) === JSON.stringify([movedAlto]));
  const readingA = await server.from("readings").select("user_id, alto_path").eq("page_id", aPages[0].id).eq("label", "A").single();
  check("the reading A belongs to the account found and points to the moved ALTO", readingA.data?.user_id === b && readingA.data?.alto_path === movedAlto, JSON.stringify(readingA));
  check("the positions moved", (await countOf("page_tokens", "user_id", b)) === 1);
  const altoBytes = await server.storage.from("alto").download(movedAlto);
  check("the moved ALTO file holds what was written", !altoBytes.error && (await altoBytes.data.text()).includes("<alto/>"));
  const after = (await server.rpc("page_allowance", { p_user_id: b })).data[0];
  check("the account found has now used 3 pages this month", after.used === 3 && after.max === 15, JSON.stringify(after));
  check("the other account is untouched", JSON.stringify([await rowsOf(c), (await filesOf(c)).length]) === JSON.stringify(cBefore));

  console.log("The photos open for the account found");
  const asB = visitor();
  await asB.auth.setSession({ access_token: found.session.access_token, refresh_token: found.session.refresh_token });
  const signed = await asB.storage.from("photos").createSignedUrl(`${b}/${aPages[0].id}/original.jpg`, 60);
  check("a signed address is given for a moved photo", !signed.error && typeof signed.data?.signedUrl === "string", signed.error?.message);
  const opened = signed.data ? await fetch(signed.data.signedUrl) : null;
  check("the moved photo opens", opened?.status === 200 && (await opened.arrayBuffer()).byteLength === JPEG.length);
  const stranger = await asB.storage.from("photos").createSignedUrl(`${c}/${cPage.id}/original.jpg`, 60);
  check("a photo of another account does not", Boolean(stranger.error));

  console.log("The phone takes the account found");
  const adopted = await main.auth.setSession({ access_token: found.session.access_token, refresh_token: found.session.refresh_token });
  check("the client of the phone is now the account found", adopted.data.user?.id === b && adopted.data.user?.is_anonymous === false, adopted.error?.message);
  const seen = await main.from("pages").select("id");
  check("the phone sees the three pages", seen.data?.length === 3);

  console.log("Replay");
  const afterReplay = [await rowsOf(b), (await filesOf(b)).length];
  const replay = await callTransfer({ authorization: `Bearer ${anonymousToken}`, "x-account-token": foundToken });
  check("the same request again is refused", replay.status === 401, JSON.stringify(replay));
  check("the replay changed nothing", JSON.stringify([await rowsOf(b), (await filesOf(b)).length]) === JSON.stringify(afterReplay));

  console.log("More than 100 pages");
  const big = visitor();
  const bigUser = (await big.auth.signInAnonymously()).data;
  created.push(bigUser.user.id);
  const bigNotebook = await notebook(bigUser.user.id, "Beaucoup");
  for (let index = 0; index < 105; index += 1) await addPage(bigUser.user.id, bigNotebook, false);
  const bigFound = await sessionFor(emailD);
  const beforeBig = (await filesOf(d)).length;
  const moved = await callTransfer({ authorization: `Bearer ${bigUser.session.access_token}`, "x-account-token": bigFound.session.access_token });
  check("105 pages and files are moved", moved.status === 200, JSON.stringify(moved));
  check("all 105 files arrived", (await filesOf(d)).length === beforeBig + 105);
  check("no file is left for the big account", (await filesOf(bigUser.user.id)).length === 0);
  check("all 105 pages arrived", (await countOf("pages", "user_id", d)) === 105);

  if (logFile !== null) {
    console.log("Logs of the function");
    const text = readFileSync(logFile, "utf8");
    const forbidden = [a, b, c, emailB, emailC, sharedName, ownName, anonymousToken, foundToken, "original.jpg", "Texte d'essai"];
    for (const word of forbidden) check(`the logs do not hold ${word.slice(0, 12)}...`, !text.includes(word));
    check("the logs say the transfer was done", text.includes("account_transferred"));
  }

  for (const id of created) await server.auth.admin.deleteUser(id);
  for (const id of created) for (const path of await filesOf(id)) await server.storage.from("photos").remove([path]);
  await clearMailbox([emailB, emailC, emailD]);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("The script stopped:", error.message);
  process.exit(1);
});
