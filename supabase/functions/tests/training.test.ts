import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleTrainingClaim } from "../training-claim/handler.ts";
import { handleTrainingUpload } from "../training-upload/handler.ts";
import { handleTrainingReport } from "../training-report/handler.ts";
import { createLogger } from "../_shared/log.ts";
import type { ClaimedTask, ReportOutcome, TrainingBucket, TrainingDeps, TrainingReport, TrainingStore, UploadOutcome } from "../_shared/ports.ts";
import { createSweepStore, createTrainingStore, StoreError } from "../_shared/supabase-adapters.ts";
import { ALICE, BOB, OTHER_PAGE_ID, PAGE_ID, readJson, RELAUNCH_SECRET } from "./fakes.ts";

const TRAINING_SECRET = "training-".repeat(5);
const TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OLD_MODEL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SHA = "ab".repeat(32);
const CANARY_TEXT = "MOOSE-CANARY-B1";
const KEYS = { url: "http://db.test", publishableKey: "publishable-key", secretKey: "secret-key" };

const MEASURES = { cer: 0.1, base_cer: 0.3, faults: 1, base_faults: 2, alphabet: 80, samples: 500, sha256: SHA };

function task(overrides: Partial<ClaimedTask> = {}): ClaimedTask {
  return {
    taskId: TASK_ID,
    userId: ALICE,
    testId: TEST_ID,
    template: "fr",
    model: { path: `${ALICE}/${OLD_MODEL}.safetensors`, sha256: SHA },
    pages: [
      { pageId: PAGE_ID, b1: CANARY_TEXT, language: "fr", corrections: [{ tokenIndex: 3, text: "Paule", readingA: "Pual" }] },
      { pageId: OTHER_PAGE_ID, b1: "autre", language: null, corrections: [] },
    ],
    ...overrides,
  };
}

class Training implements TrainingStore {
  claims = 0;
  reports: [string, TrainingReport][] = [];
  signed: [TrainingBucket, string[]][] = [];
  uploads: string[] = [];
  removed: string[][] = [];
  constructor(
    public next: ClaimedTask | null = task(),
    public missing: string[] = [],
    public target: { outcome: UploadOutcome; path: string | null } = { outcome: "ready", path: `${ALICE}/${TASK_ID}.safetensors` },
    public answer: { outcome: ReportOutcome; remove: string[] } = { outcome: "activated", remove: [] },
  ) {}
  claim(): Promise<ClaimedTask | null> {
    this.claims++;
    return Promise.resolve(this.next);
  }
  uploadTarget(_taskId: string): Promise<{ outcome: UploadOutcome; path: string | null }> {
    return Promise.resolve(this.target);
  }
  report(taskId: string, report: TrainingReport): Promise<{ outcome: ReportOutcome; remove: string[] }> {
    this.reports.push([taskId, report]);
    return Promise.resolve(this.answer);
  }
  signedReads(bucket: TrainingBucket, paths: readonly string[], _seconds: number): Promise<(string | null)[]> {
    this.signed.push([bucket, [...paths]]);
    return Promise.resolve(paths.map((path) => (this.missing.includes(path) ? null : `/storage/v1/object/sign/${bucket}/${path}?token=t`)));
  }
  signedUpload(path: string): Promise<string> {
    this.uploads.push(path);
    return Promise.resolve(`/storage/v1/object/upload/sign/models/${path}?token=u`);
  }
  removeModels(paths: readonly string[]): Promise<void> {
    this.removed.push([...paths]);
    return Promise.resolve();
  }
}

function deps(training: Training, lines: string[] = [], secret = TRAINING_SECRET): TrainingDeps {
  return { secret, training, log: createLogger((line) => lines.push(line)) };
}

function call(secret: string | null, body: unknown, method = "POST", header = "x-training-secret"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers[header] = secret;
  return new Request("http://functions.test/fn", {
    method,
    headers,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const HANDLERS = [
  ["training-claim", handleTrainingClaim, {}],
  ["training-upload", handleTrainingUpload, { task_id: TASK_ID }],
  ["training-report", handleTrainingReport, { task_id: TASK_ID, outcome: "failed" }],
] as const;

for (const [name, handle, body] of HANDLERS) {
  for (const [label, request] of [
    ["without the secret", call(null, body)],
    ["with a wrong secret", call("wrong-".repeat(7), body)],
    ["with the secret of the relaunch task", call(RELAUNCH_SECRET, body)],
    ["with the secret in another header", call(TRAINING_SECRET, body, "POST", "x-sweep-secret")],
  ] as const) {
    Deno.test(`${name} refuses a call ${label} and touches nothing`, async () => {
      const training = new Training();
      const response = await handle(request, deps(training));
      assertEquals(response.status, 401);
      assertEquals(await readJson(response), { error: "unauthenticated" });
      assertEquals([training.claims, training.reports.length, training.signed.length, training.uploads.length], [0, 0, 0, 0]);
    });
  }

  Deno.test(`${name} refuses everything when no secret is configured`, async () => {
    for (const configured of ["", "short-secret", ` ${TRAINING_SECRET}`]) {
      const training = new Training();
      const response = await handle(call(configured, body), deps(training, [], configured));
      assertEquals(response.status, 401);
      assertEquals([training.claims, training.reports.length], [0, 0]);
    }
  });

  Deno.test(`${name} answers 405 to a GET`, async () => {
    const response = await handle(call(TRAINING_SECRET, null, "GET"), deps(new Training()));
    assertEquals(response.status, 405);
  });
}

Deno.test("training-claim takes a body of exactly nothing", async () => {
  for (const body of [{ user_id: ALICE }, [], "nope", null]) {
    const training = new Training();
    const response = await handleTrainingClaim(call(TRAINING_SECRET, body), deps(training));
    assertEquals(response.status, 400);
    assertEquals(training.claims, 0);
  }
});

Deno.test("training-claim answers no task when the queue is empty", async () => {
  const response = await handleTrainingClaim(call(TRAINING_SECRET, {}), deps(new Training(null)));
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { task: null });
});

Deno.test("training-claim gives the data of one task: signed addresses of the test, the active model and the pages, B1 and the corrections", async () => {
  const training = new Training();
  const response = await handleTrainingClaim(call(TRAINING_SECRET, {}), deps(training));
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), {
    task: {
      task_id: TASK_ID,
      template: "fr",
      test: [
        `/storage/v1/object/sign/photos/${ALICE}/writing-tests/${TEST_ID}/1.jpg?token=t`,
        `/storage/v1/object/sign/photos/${ALICE}/writing-tests/${TEST_ID}/2.jpg?token=t`,
      ],
      model: { url: `/storage/v1/object/sign/models/${ALICE}/${OLD_MODEL}.safetensors?token=t`, sha256: SHA },
      pages: [
        {
          photo: `/storage/v1/object/sign/photos/${ALICE}/${PAGE_ID}/original.jpg?token=t`,
          b1: CANARY_TEXT,
          language: "fr",
          corrections: [{ token_index: 3, text: "Paule", reading_a: "Pual" }],
        },
        { photo: `/storage/v1/object/sign/photos/${ALICE}/${OTHER_PAGE_ID}/original.jpg?token=t`, b1: "autre", language: null, corrections: [] },
      ],
    },
  });
  assert(training.signed.every(([, paths]) => paths.every((path) => path.startsWith(`${ALICE}/`))), "only the files of the task's user are signed");
});

Deno.test("training-claim names neither the user nor the pages", async () => {
  const response = await handleTrainingClaim(call(TRAINING_SECRET, {}), deps(new Training()));
  const text = await response.text();
  assert(!text.includes(`"user_id"`) && !text.includes(`"page_id"`) && !text.includes(`"test_id"`));
});

Deno.test("training-claim leaves out a page whose photo is gone", async () => {
  const training = new Training(task(), [`${ALICE}/${PAGE_ID}/original.jpg`]);
  const body = await readJson(await handleTrainingClaim(call(TRAINING_SECRET, {}), deps(training)));
  assertEquals(((body.task as { pages: unknown[] }).pages).length, 1);
});

Deno.test("training-claim without a personal model gives none", async () => {
  const body = await readJson(await handleTrainingClaim(call(TRAINING_SECRET, {}), deps(new Training(task({ model: null })))));
  assertEquals((body.task as { model: unknown }).model, null);
});

for (const missing of [`${ALICE}/writing-tests/${TEST_ID}/2.jpg`, `${ALICE}/${OLD_MODEL}.safetensors`]) {
  Deno.test(`training-claim fails the task at once when ${missing.endsWith(".jpg") ? "a photo of the test" : "the active model"} cannot be signed`, async () => {
    const training = new Training(task(), [missing]);
    const response = await handleTrainingClaim(call(TRAINING_SECRET, {}), deps(training));
    assertEquals(await readJson(response), { task: null });
    assertEquals(training.reports, [[TASK_ID, { outcome: "failed" }]]);
  });
}

Deno.test("training-claim logs a count, never B1, a user, a page or an address", async () => {
  const lines: string[] = [];
  await handleTrainingClaim(call(TRAINING_SECRET, {}), deps(new Training(), lines));
  assertEquals(lines.map((line) => JSON.parse(line)), [{ event: "training_claimed", code: "claimed", files: 2 }]);
  assert(lines.every((line) => !line.includes(CANARY_TEXT) && !line.includes(ALICE) && !line.includes(PAGE_ID) && !line.includes("token")));
});

Deno.test("training-upload signs the path the database fixed, and that path alone", async () => {
  const training = new Training();
  const response = await handleTrainingUpload(call(TRAINING_SECRET, { task_id: TASK_ID }), deps(training));
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { url: `/storage/v1/object/upload/sign/models/${ALICE}/${TASK_ID}.safetensors?token=u` });
  assertEquals(training.uploads, [`${ALICE}/${TASK_ID}.safetensors`]);
});

Deno.test("training-upload takes a body of exactly the task id", async () => {
  for (const body of [{}, { task_id: "x" }, { task_id: TASK_ID, path: `${BOB}/x.safetensors` }, { task_id: TASK_ID, user_id: BOB }]) {
    const training = new Training();
    const response = await handleTrainingUpload(call(TRAINING_SECRET, body), deps(training));
    assertEquals(response.status, 400);
    assertEquals(training.uploads, []);
  }
});

for (const [outcome, status] of [["task_not_found", 404], ["task_expired", 409], ["consent_required", 409]] as const) {
  Deno.test(`training-upload answers ${status} ${outcome} and signs nothing`, async () => {
    const training = new Training(task(), [], { outcome, path: null });
    const response = await handleTrainingUpload(call(TRAINING_SECRET, { task_id: TASK_ID }), deps(training));
    assertEquals(response.status, status);
    assertEquals(await readJson(response), { error: outcome });
    assertEquals(training.uploads, []);
  });
}

Deno.test("training-report passes the measures of a trained model", async () => {
  const training = new Training();
  const response = await handleTrainingReport(call(TRAINING_SECRET, { task_id: TASK_ID, outcome: "trained", ...MEASURES }), deps(training));
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { outcome: "activated" });
  assertEquals(training.reports, [[TASK_ID, {
    outcome: "trained",
    measures: { cer: 0.1, baseCer: 0.3, faults: 1, baseFaults: 2, alphabet: 80, samples: 500, sha256: SHA },
  }]]);
});

for (const [label, body] of [
  ["a missing measure", { task_id: TASK_ID, outcome: "trained", ...MEASURES, sha256: undefined }],
  ["an extra field", { task_id: TASK_ID, outcome: "trained", ...MEASURES, user_id: BOB }],
  ["a negative CER", { task_id: TASK_ID, outcome: "trained", ...MEASURES, cer: -0.1 }],
  ["a CER above 10", { task_id: TASK_ID, outcome: "trained", ...MEASURES, base_cer: 11 }],
  ["a CER given in percent", { task_id: TASK_ID, outcome: "trained", ...MEASURES, cer: 12.9 }],
  ["nine faults", { task_id: TASK_ID, outcome: "trained", ...MEASURES, faults: 9 }],
  ["a fraction of a fault", { task_id: TASK_ID, outcome: "trained", ...MEASURES, base_faults: 1.5 }],
  ["no sample", { task_id: TASK_ID, outcome: "trained", ...MEASURES, samples: 0 }],
  ["more than 20,000 samples", { task_id: TASK_ID, outcome: "trained", ...MEASURES, samples: 20_001 }],
  ["a fingerprint in capitals", { task_id: TASK_ID, outcome: "trained", ...MEASURES, sha256: SHA.toUpperCase() }],
  ["a CER as text", { task_id: TASK_ID, outcome: "trained", ...MEASURES, cer: "0.1" }],
  ["measures with a failure", { task_id: TASK_ID, outcome: "failed", cer: 0.1 }],
  ["another outcome", { task_id: TASK_ID, outcome: "activated" }],
  ["a bad task id", { task_id: "nope", outcome: "failed" }],
] as const) {
  Deno.test(`training-report refuses ${label}`, async () => {
    const training = new Training();
    const response = await handleTrainingReport(call(TRAINING_SECRET, body), deps(training));
    assertEquals(response.status, 400);
    assertEquals(training.reports, []);
  });
}

Deno.test("training-report erases the files the database names", async () => {
  const remove = [`${ALICE}/${TASK_ID}.safetensors`];
  const training = new Training(task(), [], undefined, { outcome: "rejected", remove });
  const response = await handleTrainingReport(call(TRAINING_SECRET, { task_id: TASK_ID, outcome: "trained", ...MEASURES }), deps(training));
  assertEquals(await readJson(response), { outcome: "rejected" });
  assertEquals(training.removed, [remove]);
});

Deno.test("a report refused after the withdrawal answers 404 and its file is erased", async () => {
  const remove = [`${ALICE}/${TASK_ID}.safetensors`];
  const training = new Training(task(), [], undefined, { outcome: "task_not_found", remove });
  const response = await handleTrainingReport(call(TRAINING_SECRET, { task_id: TASK_ID, outcome: "trained", ...MEASURES }), deps(training));
  assertEquals(response.status, 404);
  assertEquals(await readJson(response), { error: "task_not_found" });
  assertEquals(training.removed, [remove]);
});

Deno.test("training-report logs the outcome and a count, never an identifier", async () => {
  const lines: string[] = [];
  const training = new Training(task(), [], undefined, { outcome: "rejected", remove: [`${ALICE}/${TASK_ID}.safetensors`] });
  await handleTrainingReport(call(TRAINING_SECRET, { task_id: TASK_ID, outcome: "trained", ...MEASURES }), deps(training, lines));
  assertEquals(lines.map((line) => JSON.parse(line)), [{ event: "training_reported", code: "rejected", files: 1 }]);
  assert(lines.every((line) => !line.includes(ALICE) && !line.includes(TASK_ID) && !line.includes(SHA)));
});

type Call = { method: string; url: URL; body: unknown };

function stub(respond: (call: Call) => { status: number; body: unknown }): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
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

const CLAIMED = {
  task_id: TASK_ID,
  user_id: ALICE,
  test_id: TEST_ID,
  template: "fr",
  model: { id: OLD_MODEL, path: `${ALICE}/${OLD_MODEL}.safetensors`, sha256: SHA },
  pages: [{ page_id: PAGE_ID, b1: "B1", language: "fr", corrections: [{ token_index: 0, text: "Paule", reading_a: null }] }],
};

Deno.test("the claim of the adapter reads the task the database gives", async () => {
  const { fetch, calls } = stub(() => ({ status: 200, body: CLAIMED }));
  const claimed = await createTrainingStore(KEYS, fetch).claim();
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/claim_training_task");
  assertEquals(claimed, {
    taskId: TASK_ID,
    userId: ALICE,
    testId: TEST_ID,
    template: "fr",
    model: { path: `${ALICE}/${OLD_MODEL}.safetensors`, sha256: SHA },
    pages: [{ pageId: PAGE_ID, b1: "B1", language: "fr", corrections: [{ tokenIndex: 0, text: "Paule", readingA: null }] }],
  });
});

for (const [label, body] of [
  ["a model of another user", { ...CLAIMED, model: { ...CLAIMED.model, path: `${BOB}/${OLD_MODEL}.safetensors` } }],
  ["a model outside the models folder shape", { ...CLAIMED, model: { ...CLAIMED.model, path: `${ALICE}/../x.ckpt` } }],
  ["a model without fingerprint", { ...CLAIMED, model: { ...CLAIMED.model, sha256: null } }],
  ["an unknown template", { ...CLAIMED, template: "de" }],
  ["a page with a bad id", { ...CLAIMED, pages: [{ ...CLAIMED.pages[0], page_id: "../x" }] }],
  ["more than 300 pages", { ...CLAIMED, pages: Array.from({ length: 301 }, () => CLAIMED.pages[0]) }],
] as const) {
  Deno.test(`the claim of the adapter refuses ${label}`, async () => {
    const { fetch } = stub(() => ({ status: 200, body }));
    assert((await thrownBy(() => createTrainingStore(KEYS, fetch).claim())) instanceof StoreError);
  });
}

Deno.test("the upload target of the adapter refuses a path that is not the task's file", async () => {
  for (const path of [`${ALICE}/${OLD_MODEL}.safetensors`, `${ALICE}/${TASK_ID}.ckpt`, `x/${TASK_ID}.safetensors`]) {
    const { fetch } = stub(() => ({ status: 200, body: [{ outcome: "ready", path }] }));
    assert((await thrownBy(() => createTrainingStore(KEYS, fetch).uploadTarget(TASK_ID))) instanceof StoreError);
  }
  const { fetch } = stub(() => ({ status: 200, body: [{ outcome: "ready", path: `${ALICE}/${TASK_ID}.safetensors` }] }));
  assertEquals(await createTrainingStore(KEYS, fetch).uploadTarget(TASK_ID), { outcome: "ready", path: `${ALICE}/${TASK_ID}.safetensors` });
});

Deno.test("signed addresses are given without their host, so the trainer only talks to its own Supabase", async () => {
  const { fetch, calls } = stub(() => ({
    status: 200,
    body: [
      { path: "a", signedURL: "/object/sign/photos/a?token=one", error: null },
      { path: "b", signedURL: null, error: "Either the object does not exist or you do not have access to it" },
    ],
  }));
  assertEquals(await createTrainingStore(KEYS, fetch).signedReads("photos", ["a", "b"], 3600), ["/storage/v1/object/sign/photos/a?token=one", null]);
  assertEquals(calls[0].url.pathname, "/storage/v1/object/sign/photos");
  assertEquals((calls[0].body as { expiresIn: number }).expiresIn, 3600);
});

Deno.test("the adapter erases only model files", async () => {
  const { fetch } = stub(() => ({ status: 200, body: [] }));
  assert((await thrownBy(() => createTrainingStore(KEYS, fetch).removeModels([`${ALICE}/${PAGE_ID}/original.jpg`]))) instanceof StoreError);
});

Deno.test("the sweep of models asks model_orphans and erases in the models bucket", async () => {
  const name = `${ALICE}/${TASK_ID}.safetensors`;
  const { fetch, calls } = stub((call) => ({ status: 200, body: call.method === "POST" ? [{ name }] : [{ name }] }));
  const store = createSweepStore(KEYS, "models", fetch);
  assertEquals(await store.orphans(500), [name]);
  assertEquals(await store.remove([name]), 1);
  assertEquals(calls.map((call) => [call.method, call.url.pathname]), [["POST", "/rest/v1/rpc/model_orphans"], ["DELETE", "/storage/v1/object/models"]]);
});

Deno.test("the sweep of writing tests erases only test photos, in the photos bucket", async () => {
  const name = `${ALICE}/writing-tests/${TEST_ID}/1.jpg`;
  const { fetch, calls } = stub(() => ({ status: 200, body: [{ name }] }));
  const store = createSweepStore(KEYS, "writingTests", fetch);
  assertEquals(await store.orphans(500), [name]);
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/writing_test_orphans");
  for (const other of [`${ALICE}/${PAGE_ID}/original.jpg`, `${ALICE}/writing-tests/${TEST_ID}/3.jpg`]) {
    const refused = stub(() => ({ status: 200, body: [{ name: other }] }));
    assert((await thrownBy(() => createSweepStore(KEYS, "writingTests", refused.fetch).orphans(500))) instanceof StoreError);
    assert((await thrownBy(() => createSweepStore(KEYS, "writingTests", refused.fetch).remove([other]))) instanceof StoreError);
  }
});
