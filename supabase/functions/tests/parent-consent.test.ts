import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../_shared/log.ts";
import { createResendMailer, MailError, mailerFrom, parentEmail } from "../_shared/parent-consent.ts";
import type { Mail, Mailer, ParentConfirmOutcome, ParentConsentDeps, ParentConsentStore, ParentRequestOutcome } from "../_shared/ports.ts";
import { handleConfirmParentConsent } from "../confirm-parent-consent/handler.ts";
import { handleRequestParentConsent } from "../request-parent-consent/handler.ts";
import { ALICE, post, readJson, TOKEN_ALICE } from "./fakes.ts";

const CODE = "042917";
const REQUEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARENT = "Parent.Lynx@Example.test";
const KEY = "re_HERON-CANARY-RESEND-KEY";

class Parents implements ParentConsentStore {
  requests: { userId: string; parentEmail: string }[] = [];
  withdrawn: { userId: string; requestId: string }[] = [];
  confirms: { userId: string; code: string }[] = [];
  requestOutcome: ParentRequestOutcome = "requested";
  confirmOutcome: ParentConfirmOutcome = "confirmed";
  attemptsLeft: number | null = null;

  request(userId: string, parentEmail: string) {
    this.requests.push({ userId, parentEmail });
    const requested = this.requestOutcome === "requested";
    return Promise.resolve({ outcome: this.requestOutcome, requestId: requested ? REQUEST_ID : null, code: requested ? CODE : null });
  }

  withdraw(userId: string, requestId: string) {
    this.withdrawn.push({ userId, requestId });
    return Promise.resolve();
  }

  confirm(userId: string, code: string) {
    this.confirms.push({ userId, code });
    return Promise.resolve({ outcome: this.confirmOutcome, attemptsLeft: this.attemptsLeft });
  }
}

class Outbox implements Mailer {
  sent: Mail[] = [];
  failure: Error | null = null;

  send(mail: Mail) {
    if (this.failure) return Promise.reject(this.failure);
    this.sent.push(mail);
    return Promise.resolve();
  }
}

type Setup = { parents: Parents; outbox: Outbox; lines: string[]; deps: ParentConsentDeps };

function setup(withMailer = true): Setup {
  const parents = new Parents();
  const outbox = new Outbox();
  const lines: string[] = [];
  const deps: ParentConsentDeps = {
    auth: { verify: (token) => Promise.resolve(token === TOKEN_ALICE ? { userId: ALICE, isAnonymous: false } : null) },
    parents,
    mailer: withMailer ? outbox : null,
    log: createLogger((line) => lines.push(line)),
  };
  return { parents, outbox, lines, deps };
}

function ask(world: Setup, body: unknown, token: string | null = TOKEN_ALICE, method = "POST") {
  return handleRequestParentConsent(post(token, body, method), world.deps);
}

function confirm(world: Setup, body: unknown, token: string | null = TOKEN_ALICE, method = "POST") {
  return handleConfirmParentConsent(post(token, body, method), world.deps);
}

function assertNoSecretIn(lines: string[]) {
  const all = lines.join("\n").toLowerCase();
  for (const word of [CODE, PARENT.toLowerCase(), "lynx", KEY.toLowerCase(), "heron", "@"]) {
    assert(!all.includes(word), `the logs contain ${word}`);
  }
}

Deno.test("request-parent-consent refuses a request without a valid token or not a POST [3]", async () => {
  for (const [token, method, status] of [[null, "POST", 401], ["token-forged", "POST", 401], [TOKEN_ALICE, "GET", 405]] as const) {
    const world = setup();
    const response = await ask(world, { parent_email: PARENT }, token, method);
    assertEquals(response.status, status);
    assertEquals(world.parents.requests, []);
    assertEquals(world.outbox.sent, []);
  }
});

Deno.test("request-parent-consent takes a body of exactly parent_email [3]", async () => {
  const bodies: unknown[] = [
    {},
    { parent_email: PARENT, user_id: ALICE },
    { email: PARENT },
    { parent_email: 42 },
    { parent_email: null },
    [PARENT],
    PARENT,
    "not json",
    null,
  ];
  for (const body of bodies) {
    const world = setup();
    const response = await ask(world, body);
    assertEquals(response.status, 400, JSON.stringify(body));
    assertEquals(await readJson(response), { error: "invalid_request" });
    assertEquals(world.parents.requests, []);
    assertEquals(world.outbox.sent, []);
  }
});

Deno.test("request-parent-consent refuses an invalid address or one over 254 characters before the database [3]", async () => {
  const long = `p@${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(56)}.test`;
  assertEquals(long.length, 255);
  const addresses = ["", "parent", "parent@localhost", "par ent@example.test", "parent@example.test\r\nBcc: x@example.test", "<parent@example.test>", "parent@exa_mple.test", "a@b@example.test", ".parent@example.test", "parent.@example.test", "par..ent@example.test", "parent@-example.test", "parent@example-.test", "parent@example..test", "parent@example.t3st", "victim%host@example.test", `${"p".repeat(65)}@example.test`, long];
  for (const address of addresses) {
    const world = setup();
    const response = await ask(world, { parent_email: address });
    assertEquals(response.status, 400, address);
    assertEquals(await readJson(response), { error: "invalid_email" });
    assertEquals(world.parents.requests, []);
    assertEquals(world.outbox.sent, []);
  }
});

Deno.test("request-parent-consent answers unavailable and writes nothing without the key of the mail provider [3]", async () => {
  const world = setup(false);
  const response = await ask(world, { parent_email: PARENT });
  assertEquals(response.status, 503);
  assertEquals(await readJson(response), { error: "unavailable" });
  assertEquals(world.parents.requests, []);
  assertEquals(world.outbox.sent, []);
});

Deno.test("request-parent-consent asks the database for the owner of the token and sends the fixed e-mail with the code [3]", async () => {
  const world = setup();
  const response = await ask(world, { parent_email: PARENT });
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { requested: true });
  assertEquals(world.parents.requests, [{ userId: ALICE, parentEmail: PARENT }]);
  assertEquals(world.outbox.sent.length, 1);
  assertEquals(world.outbox.sent[0], { to: PARENT.toLowerCase(), ...parentEmail(CODE) });
  assertEquals(world.parents.withdrawn, []);
});

Deno.test("request-parent-consent passes on each refusal of the database and sends nothing [3]", async () => {
  const cases: [ParentRequestOutcome, number][] = [
    ["account_not_registered", 403],
    ["age_missing", 409],
    ["not_under_age", 409],
    ["consent_already_active", 409],
    ["invalid_email", 400],
    ["same_email", 400],
    ["send_limit", 429],
  ];
  for (const [outcome, status] of cases) {
    const world = setup();
    world.parents.requestOutcome = outcome;
    const response = await ask(world, { parent_email: PARENT });
    assertEquals(response.status, status, outcome);
    assertEquals(await readJson(response), { error: outcome });
    assertEquals(world.outbox.sent, []);
  }
});

Deno.test("request-parent-consent accepts the usual shapes of an address [3]", async () => {
  for (const address of ["parent@example.test", "first.last+kid@mail.example.co.uk", "p_1-2@a-b.example.fr", `${"p".repeat(64)}@example.test`]) {
    const world = setup();
    const response = await ask(world, { parent_email: address });
    assertEquals(response.status, 200, address);
  }
});

Deno.test("request-parent-consent fails without sending when the database answers requested without a code [3]", async () => {
  const world = setup();
  world.parents.request = (userId, parentEmail) => {
    world.parents.requests.push({ userId, parentEmail });
    return Promise.resolve({ outcome: "requested", requestId: REQUEST_ID, code: null });
  };
  const response = await ask(world, { parent_email: PARENT });
  assertEquals(response.status, 500);
  assertEquals(world.outbox.sent, []);
});

Deno.test("request-parent-consent withdraws the request when the e-mail cannot be sent [3]", async () => {
  const world = setup();
  world.outbox.failure = new MailError(500);
  const response = await ask(world, { parent_email: PARENT });
  assertEquals(response.status, 502);
  assertEquals(await readJson(response), { error: "send_failed" });
  assertEquals(world.parents.withdrawn, [{ userId: ALICE, requestId: REQUEST_ID }]);
  assert(world.lines.some((line) => line.includes("parent_email_failed")));
});

Deno.test("request-parent-consent never logs the address, the code or the key [3]", async () => {
  for (const failure of [null, new MailError(422), new Error(`${PARENT} ${CODE} ${KEY}`)]) {
    const world = setup();
    world.outbox.failure = failure;
    await ask(world, { parent_email: PARENT });
    assertNoSecretIn(world.lines);
  }
});

Deno.test("the e-mail to the parent is a fixed text, French then English, with the code and no link [3]", () => {
  const mail = parentEmail(CODE);
  assert(mail.text.includes(CODE));
  assertEquals(mail.text.split(CODE).length, 3);
  const french = mail.text.indexOf("entraînement");
  const english = mail.text.indexOf("training");
  assert(french >= 0 && english > french, "French comes before English");
  for (const word of ["facultatif", "optional", "retirer", "withdraw", "7 jours", "7 days", "photos"]) {
    assert(mail.text.includes(word), `the e-mail says ${word}`);
  }
  for (const link of ["http", "://", "www.", "@", "<", ">"]) {
    assert(!mail.text.includes(link) && !mail.subject.includes(link), `the e-mail holds ${link}`);
  }
  assertEquals(parentEmail("111111").text.replaceAll("111111", CODE), mail.text);
});

Deno.test("confirm-parent-consent refuses a request without a valid token or not a POST [3]", async () => {
  for (const [token, method, status] of [[null, "POST", 401], ["token-forged", "POST", 401], [TOKEN_ALICE, "GET", 405]] as const) {
    const world = setup();
    const response = await confirm(world, { code: CODE }, token, method);
    assertEquals(response.status, status);
    assertEquals(world.parents.confirms, []);
  }
});

Deno.test("confirm-parent-consent takes a body of exactly a six-digit code [3]", async () => {
  const bodies: unknown[] = [{}, { code: CODE, user_id: ALICE }, { code: 42917 }, { code: "42917" }, { code: "0429170" }, { code: "04291a" }, { code: ` ${CODE}` }, [CODE], CODE, "not json", null];
  for (const body of bodies) {
    const world = setup();
    const response = await confirm(world, body);
    assertEquals(response.status, 400, JSON.stringify(body));
    assertEquals(await readJson(response), { error: "invalid_request" });
    assertEquals(world.parents.confirms, []);
  }
});

Deno.test("confirm-parent-consent confirms for the owner of the token, even without the mail key [3]", async () => {
  const world = setup(false);
  const response = await confirm(world, { code: CODE });
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { confirmed: true });
  assertEquals(world.parents.confirms, [{ userId: ALICE, code: CODE }]);
});

Deno.test("confirm-parent-consent tells the attempts left after a wrong code [3]", async () => {
  const world = setup();
  world.parents.confirmOutcome = "wrong_code";
  world.parents.attemptsLeft = 3;
  const response = await confirm(world, { code: CODE });
  assertEquals(response.status, 400);
  assertEquals(await readJson(response), { error: "wrong_code", attempts_left: 3 });
});

Deno.test("confirm-parent-consent passes on each refusal of the database [3]", async () => {
  const cases: [ParentConfirmOutcome, number][] = [
    ["no_request", 404],
    ["invalid_code", 400],
    ["code_expired", 410],
    ["account_not_registered", 403],
    ["consent_version_outdated", 409],
    ["age_missing", 409],
    ["not_under_age", 409],
    ["consent_already_active", 409],
  ];
  for (const [outcome, status] of cases) {
    const world = setup();
    world.parents.confirmOutcome = outcome;
    const response = await confirm(world, { code: CODE });
    assertEquals(response.status, status, outcome);
    assertEquals(await readJson(response), { error: outcome });
  }
});

Deno.test("confirm-parent-consent never logs the code [3]", async () => {
  for (const outcome of ["confirmed", "wrong_code", "code_expired"] as const) {
    const world = setup();
    world.parents.confirmOutcome = outcome;
    await confirm(world, { code: CODE });
    assertNoSecretIn(world.lines);
  }
});

Deno.test("the mailer exists only with a key [3]", () => {
  assertEquals(mailerFrom(() => undefined), null);
  assertEquals(mailerFrom(() => ""), null);
  assert(mailerFrom((name) => (name === "RESEND_API_KEY" ? KEY : undefined)) !== null);
});

Deno.test("the Resend mailer posts a plain-text e-mail with the key and throws a MailError without the provider's words [3]", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let status = 200;
  const fetcher = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response(JSON.stringify(status === 200 ? { id: "x" } : { message: `${PARENT} rejected` }), { status }));
  };
  const mailer = createResendMailer(KEY, fetcher as typeof fetch);
  const mail = { to: PARENT.toLowerCase(), ...parentEmail(CODE) };
  await mailer.send(mail);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://api.resend.com/emails");
  assertEquals(calls[0].init?.method, "POST");
  const headers = new Headers(calls[0].init?.headers);
  assertEquals(headers.get("authorization"), `Bearer ${KEY}`);
  assertEquals(headers.get("content-type"), "application/json");
  const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
  assertEquals(Object.keys(body).sort(), ["from", "subject", "text", "to"]);
  assertEquals(body.to, [mail.to]);
  assertEquals(body.subject, mail.subject);
  assertEquals(body.text, mail.text);
  assert(calls[0].init?.signal instanceof AbortSignal);

  status = 422;
  let thrown: unknown = null;
  try {
    await mailer.send(mail);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof MailError);
  assertEquals(thrown.status, 422);
  assert(!thrown.message.includes("lynx"));
});
