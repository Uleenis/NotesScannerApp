import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleSweepAlto } from "../sweep-alto/handler.ts";
import { createLogger } from "../_shared/log.ts";
import type { SweepAltoDeps, SweepStore } from "../_shared/ports.ts";
import { createSweepStore, StoreError } from "../_shared/supabase-adapters.ts";
import { ALICE, BOB, OTHER_PAGE_ID, PAGE_ID, readJson, RELAUNCH_SECRET } from "./fakes.ts";

const SWEEP_SECRET = "sweep-".repeat(7);
const KEYS = { url: "http://db.test", publishableKey: "publishable-key", secretKey: "secret-key" };

function altoPath(userId: string, index: number): string {
  return `${userId}/${PAGE_ID}/a-${index.toString(16).padStart(32, "0")}.xml`;
}

class Bucket implements SweepStore {
  orphanCalls: number[] = [];
  removals: string[][] = [];
  constructor(public alto: string[], private options: { keepFiles?: boolean; failOrphans?: boolean; failRemove?: boolean } = {}) {}
  orphans(limit: number): Promise<string[]> {
    this.orphanCalls.push(limit);
    if (this.options.failOrphans) return Promise.reject(new StoreError("altoOrphans"));
    return Promise.resolve(this.alto.slice(0, limit));
  }
  remove(paths: readonly string[]): Promise<number> {
    this.removals.push([...paths]);
    if (this.options.failRemove) return Promise.reject(new StoreError("removeAlto"));
    if (this.options.keepFiles) return Promise.resolve(0);
    const before = this.alto.length;
    this.alto = this.alto.filter((path) => !paths.includes(path));
    return Promise.resolve(before - this.alto.length);
  }
}

function deps(bucket: Bucket, lines: string[] = [], step = 0): SweepAltoDeps {
  let now = 0;
  return {
    secret: SWEEP_SECRET,
    sweeps: bucket,
    clock: { now: () => (now += step) },
    log: createLogger((line) => lines.push(line)),
  };
}

function sweep(secret: string | null, body: string | null = "{}", method = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-sweep-secret"] = secret;
  return new Request("http://functions.test/sweep-alto", { method, headers, body: method === "GET" ? undefined : body ?? undefined });
}

Deno.test("sweep-alto erases every orphan the database names and answers how many", async () => {
  const bucket = new Bucket([altoPath(ALICE, 1), altoPath(BOB, 2)]);
  const response = await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket));
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { removed: 2 });
  assertEquals(bucket.alto, []);
  assertEquals(bucket.orphanCalls, [500]);
});

Deno.test("sweep-alto with no orphan removes nothing", async () => {
  const bucket = new Bucket([]);
  const response = await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket));
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { removed: 0 });
  assertEquals(bucket.removals, []);
});

Deno.test("sweep-alto goes batch after batch of 500 until the orphans run out", async () => {
  const bucket = new Bucket(Array.from({ length: 1234 }, (_, index) => altoPath(ALICE, index)));
  const response = await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket));
  assertEquals(await readJson(response), { removed: 1234 });
  assertEquals(bucket.orphanCalls, [500, 500, 500]);
  assertEquals(bucket.removals.map((paths) => paths.length), [500, 500, 234]);
});

Deno.test("sweep-alto stops after 20 batches in one night", async () => {
  const bucket = new Bucket(Array.from({ length: 12000 }, (_, index) => altoPath(ALICE, index)));
  const response = await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket));
  assertEquals(await readJson(response), { removed: 10000 });
  assertEquals(bucket.orphanCalls.length, 20);
  assertEquals(bucket.alto.length, 2000);
});

Deno.test("sweep-alto stops once a minute has passed", async () => {
  const bucket = new Bucket(Array.from({ length: 1500 }, (_, index) => altoPath(ALICE, index)));
  const response = await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket, [], 61_000));
  assertEquals(await readJson(response), { removed: 500 });
  assertEquals(bucket.orphanCalls.length, 1);
});

Deno.test("sweep-alto does not go round again when the storage kept the files it was asked to remove", async () => {
  const bucket = new Bucket(Array.from({ length: 600 }, (_, index) => altoPath(ALICE, index)), { keepFiles: true });
  const response = await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket));
  assertEquals(await readJson(response), { removed: 0 });
  assertEquals(bucket.orphanCalls.length, 1);
});

for (const [name, request] of [
  ["a request without the secret", sweep(null)],
  ["a request with a wrong secret", sweep("wrong-".repeat(6))],
  ["a request with the secret of the relaunch task", sweep(RELAUNCH_SECRET)],
  ["a request with a prefix of the secret", sweep(SWEEP_SECRET.slice(0, 41))],
] as const) {
  Deno.test(`sweep-alto refuses ${name} and touches nothing`, async () => {
    const bucket = new Bucket([altoPath(ALICE, 1)]);
    const response = await handleSweepAlto(request, deps(bucket));
    assertEquals(response.status, 401);
    assertEquals(await readJson(response), { error: "unauthenticated" });
    assertEquals(bucket.orphanCalls, []);
    assertEquals(bucket.removals, []);
  });
}

Deno.test("sweep-alto refuses any method but POST", async () => {
  const bucket = new Bucket([altoPath(ALICE, 1)]);
  const response = await handleSweepAlto(sweep(SWEEP_SECRET, null, "GET"), deps(bucket));
  assertEquals(response.status, 405);
  assertEquals(bucket.orphanCalls, []);
});

for (const body of ['{"page_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', '{"user_id":"x"}', "[]", "null", "not json", ""]) {
  Deno.test(`sweep-alto refuses the body ${JSON.stringify(body)}: the request names nothing`, async () => {
    const bucket = new Bucket([altoPath(ALICE, 1)]);
    const response = await handleSweepAlto(sweep(SWEEP_SECRET, body), deps(bucket));
    assertEquals(response.status, 400);
    assertEquals(await readJson(response), { error: "invalid_request" });
    assertEquals(bucket.orphanCalls, []);
  });
}

Deno.test("sweep-alto answers 500 when the storage fails, and logs no path", async () => {
  for (const options of [{ failOrphans: true }, { failRemove: true }]) {
    const lines: string[] = [];
    const bucket = new Bucket([altoPath(ALICE, 1)], options);
    const response = await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket, lines));
    assertEquals(response.status, 500);
    assertEquals(await readJson(response), { error: "internal_error" });
    assert(lines.every((line) => !line.includes(ALICE) && !line.includes(PAGE_ID)));
  }
});

Deno.test("sweep-alto that fails after a first batch still logs the files it erased", async () => {
  const lines: string[] = [];
  const bucket = new Bucket(Array.from({ length: 700 }, (_, index) => altoPath(ALICE, index)));
  let calls = 0;
  const orphans = bucket.orphans.bind(bucket);
  bucket.orphans = (limit) => (++calls === 2 ? Promise.reject(new StoreError("altoOrphans")) : orphans(limit));
  const response = await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket, lines));
  assertEquals(response.status, 500);
  const done = lines.map((line) => JSON.parse(line)).find((record) => record.event === "alto_swept");
  assertEquals(done?.files, 500);
  assertEquals(done?.code, "interrupted");
});

Deno.test("sweep-alto logs no sweep when it refuses the call", async () => {
  const lines: string[] = [];
  await handleSweepAlto(sweep(null), deps(new Bucket([altoPath(ALICE, 1)]), lines));
  assert(lines.every((line) => JSON.parse(line).event !== "alto_swept"));
});

Deno.test("sweep-alto logs how many files it erased and how long it took, never a path or an account", async () => {
  const lines: string[] = [];
  const bucket = new Bucket([altoPath(ALICE, 1), altoPath(BOB, 2)]);
  await handleSweepAlto(sweep(SWEEP_SECRET), deps(bucket, lines, 5));
  const done = lines.map((line) => JSON.parse(line)).find((record) => record.event === "alto_swept");
  assertEquals(done?.files, 2);
  assertEquals(typeof done?.durationMs, "number");
  assert(lines.every((line) => !line.includes(ALICE) && !line.includes(BOB) && !line.includes(PAGE_ID) && !line.includes(SWEEP_SECRET)));
});

type Call = { method: string; url: URL; headers: Headers; body: unknown };

function stub(respond: (call: Call) => { status: number; body: unknown }): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const { status, body } = respond(call);
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  };
  return { fetch: fetcher as typeof fetch, calls };
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return null;
}

Deno.test("the orphans are asked of alto_orphans with the limit alone, as the service", async () => {
  const names = [altoPath(ALICE, 1), `${BOB}/${OTHER_PAGE_ID}/a-2.xml`];
  const { fetch, calls } = stub(() => ({ status: 200, body: names.map((name) => ({ name })) }));
  assertEquals(await createSweepStore(KEYS, fetch).orphans(500), names);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/alto_orphans");
  assertEquals(calls[0].body, { p_limit: 500 });
  assertEquals(calls[0].headers.get("apikey"), "secret-key");
});

for (const name of ["photos/x.jpg", `${ALICE}/${PAGE_ID}`, `${ALICE}/${PAGE_ID}/../x.xml`, `${ALICE}/${PAGE_ID}/.hidden`, `${ALICE}/${PAGE_ID}/a/b.xml`, `${PAGE_ID.toUpperCase()}/${PAGE_ID}/a.xml`, 42, null]) {
  Deno.test(`an answer naming ${JSON.stringify(name)} is an error, never a file to erase`, async () => {
    const { fetch } = stub(() => ({ status: 200, body: [{ name: altoPath(ALICE, 1) }, { name }] }));
    assertEquals((await thrownBy(() => createSweepStore(KEYS, fetch).orphans(500))) instanceof StoreError, true);
  });
}

Deno.test("an answer that is not a list, or a refused call, is an error", async () => {
  for (const reply of [{ status: 200, body: { name: altoPath(ALICE, 1) } }, { status: 500, body: { message: "boom" } }]) {
    const { fetch } = stub(() => reply);
    assertEquals((await thrownBy(() => createSweepStore(KEYS, fetch).orphans(500))) instanceof StoreError, true);
  }
});

Deno.test("erasing the orphans removes them from the alto bucket alone, 100 at most at a time, and counts what the storage removed", async () => {
  const paths = Array.from({ length: 250 }, (_, index) => altoPath(ALICE, index));
  const { fetch, calls } = stub((call) => {
    const prefixes = (call.body as { prefixes: string[] }).prefixes;
    return { status: 200, body: prefixes.slice(1).map((name) => ({ name })) };
  });
  assertEquals(await createSweepStore(KEYS, fetch).remove(paths), 247);
  assertEquals(calls.map((call) => [call.method, call.url.pathname]), [
    ["DELETE", "/storage/v1/object/alto"],
    ["DELETE", "/storage/v1/object/alto"],
    ["DELETE", "/storage/v1/object/alto"],
  ]);
  assertEquals(calls.map((call) => (call.body as { prefixes: string[] }).prefixes.length), [100, 100, 50]);
  assertEquals(calls.flatMap((call) => (call.body as { prefixes: string[] }).prefixes), paths);
});

Deno.test("a storage failure while erasing is an error", async () => {
  const { fetch } = stub(() => ({ status: 500, body: { statusCode: "500", error: "internal", message: "Internal error" } }));
  assertEquals((await thrownBy(() => createSweepStore(KEYS, fetch).remove([altoPath(ALICE, 1)]))) instanceof StoreError, true);
});
