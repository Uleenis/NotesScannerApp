import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleCheckWritingTest } from "../check-writing-test/handler.ts";
import { handlePrepareWritingTest } from "../prepare-writing-test/handler.ts";
import { ALICE, BOB, CANARY_UPLOAD_TOKEN, DAY_MS, JPEG_BYTES, PNG_BYTES, post, readJson, TOKEN_ALICE, TOKEN_BOB, World } from "./fakes.ts";

function prepare(world: World, token: string | null, body: unknown = { template: "fr" }) {
  return handlePrepareWritingTest(post(token, body), world.prepareWritingDeps());
}

function check(world: World, token: string | null, body: unknown, configured: boolean = true) {
  return handleCheckWritingTest(post(token, body), world.checkWritingDeps(configured));
}

function consenting(): World {
  const world = new World();
  world.activeConsents.add(ALICE);
  world.activeConsents.add(BOB);
  return world;
}

async function started(world: World, token: string = TOKEN_ALICE, template: string = "fr"): Promise<string> {
  const response = await prepare(world, token, { template });
  assertEquals(response.status, 200);
  return (await readJson(response)).test_id as string;
}

function sheet(userId: string, testId: string, number: 1 | 2): string {
  return `${userId}/writing-tests/${testId}/${number}.jpg`;
}

function photograph(world: World, userId: string, testId: string, bytes: Uint8Array = JPEG_BYTES): void {
  for (const number of [1, 2] as const) {
    world.photos.set(sheet(userId, testId, number), { bytes, mimeType: "image/jpeg", size: bytes.length });
  }
}

function filesOfTest(world: World, userId: string, testId: string): string[] {
  return [...world.photos.keys()].filter((path) => path.startsWith(`${userId}/writing-tests/${testId}/`)).sort();
}

Deno.test("prepare-writing-test refuses a request without a token, with a forged one, or that is not a POST [5]", async () => {
  const world = consenting();
  assertEquals((await prepare(world, null)).status, 401);
  assertEquals((await prepare(world, "token-forged")).status, 401);
  assertEquals((await handlePrepareWritingTest(post(TOKEN_ALICE, "", "GET"), world.prepareWritingDeps())).status, 405);
  assertEquals(world.writingTests.size, 0);
  assertEquals(world.uploadPaths, []);
});

Deno.test("prepare-writing-test takes a body of exactly the template, French or English [5]", async () => {
  for (const body of [{}, { template: "de" }, { template: "FR" }, { template: 1 }, { template: "fr", user_id: BOB }, { template: "fr", extra: 1 }, [], "fr", "not json", null]) {
    const world = consenting();
    const response = await prepare(world, TOKEN_ALICE, typeof body === "string" && body === "not json" ? "{nope" : body);
    assertEquals(response.status, 400);
    assertEquals(await readJson(response), { error: "invalid_request" });
    assertEquals(world.writingTests.size, 0);
  }
});

Deno.test("prepare-writing-test needs an active consent and writes nothing without one [5]", async () => {
  const world = new World();
  const response = await prepare(world, TOKEN_ALICE);
  assertEquals(response.status, 403);
  assertEquals(await readJson(response), { error: "consent_required" });
  assertEquals(world.writingTests.size, 0);
  assertEquals(world.uploadPaths, []);
});

Deno.test("prepare-writing-test starts a test and gives one upload per sheet, in the folder of the caller [5]", async () => {
  const world = consenting();
  const response = await prepare(world, TOKEN_ALICE, { template: "en" });
  assertEquals(response.status, 200);
  const body = await readJson(response);
  const id = body.test_id as string;
  assertEquals(Object.keys(body).sort(), ["test_id", "uploads"]);
  assertEquals(body.uploads, [
    { path: sheet(ALICE, id, 1), token: CANARY_UPLOAD_TOKEN },
    { path: sheet(ALICE, id, 2), token: CANARY_UPLOAD_TOKEN },
  ]);
  assertEquals(world.uploadPaths, [sheet(ALICE, id, 1), sheet(ALICE, id, 2)]);
  const test = world.writingTests.get(id);
  assertEquals([test?.userId, test?.template, test?.status], [ALICE, "en", "pending"]);
});

Deno.test("prepare-writing-test allows one test in progress at a time [5]", async () => {
  const world = consenting();
  await started(world);
  const response = await prepare(world, TOKEN_ALICE);
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "test_in_progress" });
  assertEquals((await prepare(world, TOKEN_BOB)).status, 200);
});

Deno.test("prepare-writing-test allows three tests in 24 hours [5]", async () => {
  const world = consenting();
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = await started(world);
    world.writingTests.get(id)!.status = "rejected";
    world.clock += 60 * 1000;
  }
  const response = await prepare(world, TOKEN_ALICE);
  assertEquals(response.status, 429);
  assertEquals(await readJson(response), { error: "test_limit" });
  world.clock += DAY_MS;
  assertEquals((await prepare(world, TOKEN_ALICE)).status, 200);
});

Deno.test("prepare-writing-test erases the photos of a test that expired before starting another [5]", async () => {
  const world = consenting();
  const old = await started(world);
  photograph(world, ALICE, old);
  world.clock += 31 * 60 * 1000;
  const fresh = await started(world);
  assertEquals(filesOfTest(world, ALICE, old), []);
  assertEquals(world.writingTests.get(old)?.status, "failed");
  assertEquals(world.writingTests.get(fresh)?.status, "pending");
});

Deno.test("prepare-writing-test leaves no test pending when the upload addresses cannot be made [5]", async () => {
  const world = consenting();
  world.failOn.add("createUploadUrl");
  const response = await prepare(world, TOKEN_ALICE);
  assertEquals(response.status, 500);
  assertEquals([...world.writingTests.values()].map((test) => test.status), ["failed"]);
});

Deno.test("check-writing-test refuses a request without a token, with a forged one, or that is not a POST [5]", async () => {
  const world = consenting();
  const id = await started(world);
  assertEquals((await check(world, null, { test_id: id })).status, 401);
  assertEquals((await check(world, "token-forged", { test_id: id })).status, 401);
  assertEquals((await handleCheckWritingTest(post(TOKEN_ALICE, "", "GET"), world.checkWritingDeps())).status, 405);
  assertEquals(world.checks, []);
});

Deno.test("check-writing-test takes a body of exactly a test id [5]", async () => {
  const world = consenting();
  const id = await started(world);
  for (const body of [{}, { test_id: "nope" }, { test_id: 5 }, { test_id: id, user_id: BOB }, { test_id: id, template: "fr" }, [], "{nope", null]) {
    const response = await check(world, TOKEN_ALICE, body);
    assertEquals(response.status, 400);
    assertEquals(await readJson(response), { error: "invalid_request" });
  }
  assertEquals(world.checks, []);
});

Deno.test("check-writing-test finds only a pending test of the caller [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  const other = await check(world, TOKEN_BOB, { test_id: id });
  assertEquals(other.status, 404);
  assertEquals(await readJson(other), { error: "test_not_found" });
  assertEquals((await check(world, TOKEN_ALICE, { test_id: "99999999-9999-4999-8999-999999999999" })).status, 404);
  world.writingTests.get(id)!.status = "rejected";
  assertEquals((await check(world, TOKEN_ALICE, { test_id: id })).status, 404);
  assertEquals(world.checks, []);
});

Deno.test("check-writing-test says so when the reading service is not configured, and keeps the test [5]", async () => {
  const world = consenting();
  const id = await started(world);
  const response = await check(world, TOKEN_ALICE, { test_id: id }, false);
  assertEquals(response.status, 503);
  assertEquals(await readJson(response), { error: "unavailable" });
  assertEquals(world.writingTests.get(id)?.status, "pending");
});

Deno.test("check-writing-test answers at once, then reads both sheets with the template and accepts a good test [5]", async () => {
  const world = consenting();
  const id = await started(world, TOKEN_ALICE, "en");
  photograph(world, ALICE, id);
  const response = await check(world, TOKEN_ALICE, { test_id: id });
  assertEquals(response.status, 202);
  assertEquals(await readJson(response), { checking: true });
  await world.settle();
  assertEquals(world.checks.map((read) => [read.template, read.sheet]), [["en", 1], ["en", 2]]);
  assertEquals(world.checks.map((read) => read.image), [JPEG_BYTES, JPEG_BYTES]);
  const test = world.writingTests.get(id);
  assertEquals([test?.status, test?.trainingLines, test?.validationLines, test?.redo], ["accepted", 30, 10, []]);
  assertEquals(filesOfTest(world, ALICE, id).length, 2);
});

Deno.test("check-writing-test rejects a test short of lines, names the sheet to redo and erases its photos [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  world.checkOutcomes.push({ ok: true, lines: 20, training: 12, validation: 0 }, { ok: true, lines: 20, training: 10, validation: 10 });
  await check(world, TOKEN_ALICE, { test_id: id });
  await world.settle();
  const test = world.writingTests.get(id);
  assertEquals([test?.status, test?.trainingLines, test?.validationLines, test?.redo], ["rejected", 22, 10, [1]]);
  assertEquals(filesOfTest(world, ALICE, id), []);
});

Deno.test("check-writing-test counts a missing or non-JPEG sheet as nothing kept, without reading it [5]", async () => {
  const world = consenting();
  const id = await started(world);
  world.photos.set(sheet(ALICE, id, 1), { bytes: JPEG_BYTES, mimeType: "image/jpeg", size: JPEG_BYTES.length });
  await check(world, TOKEN_ALICE, { test_id: id });
  await world.settle();
  assertEquals(world.checks.map((read) => read.sheet), [1]);
  assertEquals([world.writingTests.get(id)?.status, world.writingTests.get(id)?.redo], ["rejected", [2]]);

  const again = consenting();
  const second = await started(again);
  again.photos.set(sheet(ALICE, second, 1), { bytes: JPEG_BYTES, mimeType: "image/jpeg", size: JPEG_BYTES.length });
  again.photos.set(sheet(ALICE, second, 2), { bytes: PNG_BYTES, mimeType: "image/jpeg", size: PNG_BYTES.length });
  await check(again, TOKEN_ALICE, { test_id: second });
  await again.settle();
  assertEquals(again.checks.map((read) => read.sheet), [1]);
  assertEquals(again.writingTests.get(second)?.redo, [2]);
});

Deno.test("check-writing-test counts a sheet the service refuses as nothing kept [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  world.checkOutcomes.push({ ok: true, lines: 20, training: 20, validation: 0 }, { ok: false, failure: { kind: "http_error", status: 422, code: "too_complex" } });
  await check(world, TOKEN_ALICE, { test_id: id });
  await world.settle();
  assertEquals([world.writingTests.get(id)?.status, world.writingTests.get(id)?.redo], ["rejected", [2]]);
});

Deno.test("check-writing-test marks the test failed and erases its photos when the service cannot be reached [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  world.checkOutcomes.push({ ok: false, failure: { kind: "network" } });
  await check(world, TOKEN_ALICE, { test_id: id });
  await world.settle();
  assertEquals(world.writingTests.get(id)?.status, "failed");
  assertEquals(filesOfTest(world, ALICE, id), []);
  assertEquals(world.checks.length, 1);
});

Deno.test("check-writing-test erases the photos of the tests an accepted test replaces, and keeps its own [5]", async () => {
  const world = consenting();
  const first = await started(world);
  photograph(world, ALICE, first);
  await check(world, TOKEN_ALICE, { test_id: first });
  await world.settle();
  world.clock += 2 * 60 * 1000;
  const second = await started(world);
  photograph(world, ALICE, second);
  await check(world, TOKEN_ALICE, { test_id: second });
  await world.settle();
  assertEquals(world.writingTests.get(first)?.status, "replaced");
  assertEquals(world.writingTests.get(second)?.status, "accepted");
  assertEquals(filesOfTest(world, ALICE, first), []);
  assertEquals(filesOfTest(world, ALICE, second).length, 2);
});

Deno.test("check-writing-test leaves the photos alone when the test is no longer pending at the end of the check [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  world.beforeFinish = () => {
    world.writingTests.get(id)!.status = "accepted";
  };
  await check(world, TOKEN_ALICE, { test_id: id });
  await world.settle();
  assertEquals(filesOfTest(world, ALICE, id).length, 2);
});

Deno.test("check-writing-test leaves the photos alone when it fails after another check accepted the test [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  world.checkOutcomes.push({ ok: false, failure: { kind: "http_error", status: 503, code: "busy" } });
  world.beforeFinish = () => undefined;
  world.writingTests.get(id)!.status = "accepted";
  const response = await handleCheckWritingTest(post(TOKEN_ALICE, { test_id: id }), { ...world.checkWritingDeps(), tests: { ...world.writingStore(), pending: () => Promise.resolve({ template: "fr" }) } });
  assertEquals(response.status, 202);
  await world.settle();
  assertEquals(world.writingTests.get(id)?.status, "accepted");
  assertEquals(filesOfTest(world, ALICE, id).length, 2);
});

Deno.test("check-writing-test erases the photos when the consent is gone at the end of the check [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  const store = world.writingStore();
  const deps = {
    ...world.checkWritingDeps(),
    tests: { ...store, finish: () => Promise.resolve({ outcome: "consent_required" as const, redo: [], replaced: [] }) },
  };
  await handleCheckWritingTest(post(TOKEN_ALICE, { test_id: id }), deps);
  await world.settle();
  assertEquals(filesOfTest(world, ALICE, id), []);
});

Deno.test("check-writing-test reads a test once however many times it is called [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  world.checkOutcomes.push("hold");
  const first = await check(world, TOKEN_ALICE, { test_id: id });
  const second = await check(world, TOKEN_ALICE, { test_id: id });
  assertEquals([first.status, second.status], [202, 202]);
  world.releaseCheck();
  await world.settle();
  assertEquals(world.checks.length, 2);
  assertEquals(world.writingTests.get(id)?.status, "accepted");
  assertEquals(world.running.size, 0);
});

Deno.test("the writing-test functions log numbers and names only, never a photo or a path [5]", async () => {
  const world = consenting();
  const id = await started(world);
  photograph(world, ALICE, id);
  await check(world, TOKEN_ALICE, { test_id: id });
  await world.settle();
  const logged = JSON.stringify(world.logs);
  assert(logged.includes("writing_test_checked"));
  for (const probe of [id, ALICE, "writing-tests", ".jpg", CANARY_UPLOAD_TOKEN, TOKEN_ALICE]) {
    assert(!logged.includes(probe), probe);
  }
});
