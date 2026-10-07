import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../_shared/log.ts";
import type { LogFields } from "../_shared/log.ts";
import { handleReadPage } from "../read-page/handler.ts";
import { handlePreparePage } from "../prepare-page/handler.ts";
import { handleDeleteAccount } from "../delete-account/handler.ts";
import { handleTransferAccount } from "../transfer-account/handler.ts";
import { GeminiFailure } from "../_shared/gemini.ts";
import {
  ALICE,
  BOB,
  CANARY_EMAIL,
  CANARY_EXCEPTION,
  CANARY_GEMINI_ERROR,
  CANARY_NOTEBOOK_NAME,
  CANARY_PAGE_TEXT,
  CANARY_UPLOAD_TOKEN,
  capture,
  CAROL,
  JPEG_BYTES,
  MAX_BYTES,
  OTHER_PAGE_ID,
  PAGE_ID,
  post,
  TOKEN_ALICE,
  TOKEN_BOB,
  TOKEN_CAROL,
  transferRequest,
  World,
} from "./fakes.ts";

const IMAGE_BASE64 = btoa(String.fromCharCode(...JPEG_BYTES));
const FORBIDDEN = [CANARY_PAGE_TEXT, CANARY_GEMINI_ERROR, CANARY_EXCEPTION, CANARY_UPLOAD_TOKEN, IMAGE_BASE64, TOKEN_ALICE, TOKEN_BOB, "Second line"];

function assertClean(text: string) {
  for (const word of FORBIDDEN) {
    assert(!text.includes(word), `the logs contain ${word}`);
  }
}

async function everythingLogged(scenario: (world: World) => Promise<void>, build: (world: World) => void = () => {}): Promise<string> {
  const world = new World();
  build(world);
  const sink: string[] = [];
  world.loggerOverride = createLogger((line) => sink.push(line));
  const spy = capture();
  try {
    await scenario(world);
  } finally {
    spy.restore();
  }
  assertEquals(spy.lines, []);
  return sink.join("\n");
}

const read = (world: World, token: string = TOKEN_ALICE, pageId: string = PAGE_ID) =>
  handleReadPage(post(token, { page_id: pageId }), world.readDeps()).then(() => undefined);

Deno.test("the logs of a successful reading hold neither the text nor the image [16]", async () => {
  const logged = await everythingLogged(
    (world) => read(world),
    (world) => {
      world.readyPage();
      world.push({ text: CANARY_PAGE_TEXT, modelVersion: null, inputTokens: 5, outputTokens: 6, thoughtsTokens: 0 });
    },
  );
  assertClean(logged);
  assert(logged.length > 0);
});

Deno.test("the logs of a failed reading hold neither the text nor Gemini's error nor the image [16]", async () => {
  const logged = await everythingLogged(
    (world) => read(world),
    (world) => {
      world.readyPage();
      const failure = new GeminiFailure("http_error");
      Object.assign(failure, { body: CANARY_GEMINI_ERROR, cause: new Error(CANARY_GEMINI_ERROR) });
      world.push(failure, new TypeError(CANARY_GEMINI_ERROR));
    },
  );
  assertClean(logged);
  assert(logged.length > 0);
});

Deno.test("the log of a failed attempt gives the status code of Gemini's answer, a number and nothing else of it", async () => {
  const logged = await everythingLogged(
    (world) => read(world),
    (world) => {
      world.readyPage();
      world.push(new GeminiFailure("http_error", 429), new GeminiFailure("http_error", 503));
    },
  );
  const attempts = logged.split(String.fromCharCode(10)).map((line) => JSON.parse(line)).filter((record) => record.event === "gemini_attempt_failed");
  assertEquals(attempts.map((record) => [record.attempt, record.kind, record.status]), [[1, "http_error", 429], [2, "http_error", 503]]);
  assertClean(logged);
});

Deno.test("the log of a failed attempt that is not an HTTP answer has no status", async () => {
  const logged = await everythingLogged(
    (world) => read(world),
    (world) => {
      world.readyPage();
      world.push(new GeminiFailure("timeout"), new TypeError("boom"));
    },
  );
  const attempts = logged.split(String.fromCharCode(10)).map((line) => JSON.parse(line)).filter((record) => record.event === "gemini_attempt_failed");
  assertEquals(attempts.map((record) => "status" in record), [false, false]);
});

Deno.test("the logs of every refusal hold neither the text nor the image [16]", async () => {
  const refusals: ((world: World) => void)[] = [
    (world) => world.addPage(BOB),
    (world) => {
      world.readyPage();
      world.page().status = "processing";
    },
    (world) => world.addPage(ALICE),
    (world) => world.addPhoto(ALICE, PAGE_ID, JPEG_BYTES, "image/png"),
    (world) => {
      world.addPage(ALICE);
      world.addPhoto(ALICE, PAGE_ID, JPEG_BYTES, "image/jpeg", MAX_BYTES + 1);
    },
    (world) => {
      world.readyPage();
      world.forcedCharge = "monthly_limit";
    },
  ];
  for (const build of refusals) {
    const logged = await everythingLogged((world) => read(world), build);
    assertClean(logged);
  }
});

Deno.test("the logs of an unexpected exception hold only its class name [16]", async () => {
  const logged = await everythingLogged(
    (world) => read(world),
    (world) => {
      world.readyPage();
      world.failOn.add("getPage");
    },
  );
  assertClean(logged);
  assert(logged.includes("Error"));
});

Deno.test("the logs of a result that cannot be written hold only the class name of the exception [16]", async () => {
  for (const step of ["insertReading", "upsertPageText", "markRead"]) {
    const logged = await everythingLogged(
      (world) => read(world),
      (world) => {
        world.readyPage();
        world.push({ text: CANARY_PAGE_TEXT, modelVersion: null, inputTokens: 5, outputTokens: 6, thoughtsTokens: 0 });
        world.failOn.add(step);
      },
    );
    assertClean(logged);
    assert(logged.includes("Error"));
  }
});

Deno.test("a page id that is not a UUID is refused before it can reach a log [16]", async () => {
  const world = new World();
  const spy = capture();
  const sink: string[] = [];
  try {
    const deps = { ...world.readDeps(), log: createLogger((line) => sink.push(line)) };
    await handleReadPage(post(TOKEN_ALICE, { page_id: "CANARY-INJECTED-ID" }), deps);
    await handlePreparePage(post(TOKEN_ALICE, { page_id: "CANARY-INJECTED-ID" }), deps);
  } finally {
    spy.restore();
  }
  assertEquals(spy.lines, []);
  assertEquals(sink.join("\n").includes("CANARY-INJECTED-ID"), false);
});

Deno.test("the logger writes one JSON line and keeps only the allowed fields", () => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  const extra = { pageId: PAGE_ID, text: CANARY_PAGE_TEXT, image: IMAGE_BASE64, durationMs: 12 } as unknown as LogFields;
  logger.event("read_done", extra);
  assertEquals(lines.length, 1);
  assertEquals(JSON.parse(lines[0]), { event: "read_done", pageId: PAGE_ID, durationMs: 12 });
  assertClean(lines[0]);
});

Deno.test("the logger drops a string field that is not short and plain", () => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  logger.event("refused", { code: `a long line of text from a page ${CANARY_PAGE_TEXT}`.repeat(10) });
  assertEquals(JSON.parse(lines[0]), { event: "refused" });
});

Deno.test("a reading logs its usage and duration but never the content [16]", async () => {
  const world = new World();
  world.readyPage(ALICE);
  world.geminiDurationMs = 321;
  await read(world);
  const done = world.logs.find((l) => l.event === "read_done");
  assertEquals(done?.fields, { pageId: PAGE_ID, durationMs: 321, inputTokens: 1100, outputTokens: 216, thoughtsTokens: 0 });
  assert(world.logs.every((l) => !JSON.stringify(l).includes("First line")));
});

const remove = (world: World, token: string = TOKEN_ALICE) =>
  handleDeleteAccount(post(token, { user_id: BOB }), world.accountDeps()).then(() => undefined);

function assertNoAccountData(text: string) {
  assertClean(text);
  for (const word of [ALICE, BOB, "original.jpg", "@example.test"]) {
    assert(!text.includes(word), `the logs contain ${word}`);
  }
}

Deno.test("the logs of an account deletion hold no id, no file name, no token and no text [16]", async () => {
  const logged = await everythingLogged(
    (world) => remove(world),
    (world) => {
      world.readyPage(ALICE);
      world.pageTexts.set(PAGE_ID, { userId: ALICE, text: CANARY_PAGE_TEXT, pipelineVersion: "1" });
    },
  );
  assertNoAccountData(logged);
  assert(logged.includes("account_deleted"));
});

Deno.test("the logs of an account deletion that fails hold the name of the error and nothing of its message [16]", async () => {
  const logged = await everythingLogged(
    (world) => remove(world),
    (world) => {
      world.readyPage(ALICE);
      world.failOn.add("removePhotos");
    },
  );
  assertNoAccountData(logged);
  assert(logged.includes("unexpected_error"));
});

Deno.test("the logs of a refused account deletion hold no token", async () => {
  const logged = await everythingLogged(
    async (world) => {
      await remove(world, "token-forged");
      await handleDeleteAccount(post(null, {}), world.accountDeps());
    },
    (world) => world.readyPage(ALICE),
  );
  assertNoAccountData(logged);
  assert(!logged.includes("token-forged"));
});

const FORBIDDEN_TRANSFER = [CANARY_NOTEBOOK_NAME, CANARY_EMAIL, CANARY_PAGE_TEXT, CAROL, TOKEN_CAROL];

function transferScene(world: World): void {
  world.anonymousUsers.add(ALICE);
  world.readyPage(ALICE);
  world.addNotebook(ALICE, CANARY_NOTEBOOK_NAME);
  world.pageTexts.set(PAGE_ID, { userId: ALICE, text: CANARY_PAGE_TEXT, pipelineVersion: "1" });
  world.readyPage(BOB, OTHER_PAGE_ID);
  world.readyPage(CAROL, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
}

function transfer(world: World, anonymousToken: string | null = TOKEN_ALICE, accountToken: string | null = TOKEN_BOB): Promise<void> {
  const request = transferRequest(anonymousToken, accountToken, { email: CANARY_EMAIL, notebook: CANARY_NOTEBOOK_NAME });
  request.headers.set("x-user-email", CANARY_EMAIL);
  return handleTransferAccount(request, world.transferDeps()).then(() => undefined);
}

function assertNoTransferData(text: string) {
  assertNoAccountData(text);
  for (const word of FORBIDDEN_TRANSFER) {
    assert(!text.includes(word), `the logs contain ${word}`);
  }
}

Deno.test("the logs of an account transfer hold no id, no token, no e-mail, no file name, no notebook name and no text [16]", async () => {
  const logged = await everythingLogged((world) => transfer(world), transferScene);
  assertNoTransferData(logged);
  assert(logged.includes("account_transferred"));
});

Deno.test("the logs of an account transfer that fails hold the name of the error and nothing of its message [16]", async () => {
  for (const name of ["copyPhoto", "moveRows", "removePhotos", "deleteUser"]) {
    const logged = await everythingLogged(
      (world) => transfer(world),
      (world) => {
        transferScene(world);
        world.failOn.add(name);
      },
    );
    assertNoTransferData(logged);
    assert(logged.includes("unexpected_error"));
  }
});

Deno.test("the logs of a refused account transfer hold no token and no id [16]", async () => {
  const logged = await everythingLogged(
    async (world) => {
      await transfer(world, "token-forged", TOKEN_BOB);
      await transfer(world, TOKEN_ALICE, "token-forged");
      await transfer(world, TOKEN_ALICE, null);
      await transfer(world, TOKEN_ALICE, TOKEN_ALICE);
      await transfer(world, TOKEN_CAROL, TOKEN_BOB);
      world.page(PAGE_ID).status = "processing";
      await transfer(world);
    },
    transferScene,
  );
  assertNoTransferData(logged);
  assert(!logged.includes("token-forged"));
  assert(logged.includes("page_processing"));
});
