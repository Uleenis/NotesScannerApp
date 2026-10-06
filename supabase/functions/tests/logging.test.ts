import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../_shared/log.ts";
import type { LogFields } from "../_shared/log.ts";
import { handleReadPage } from "../read-page/handler.ts";
import { handlePreparePage } from "../prepare-page/handler.ts";
import { GeminiFailure } from "../_shared/gemini.ts";
import {
  ALICE,
  BOB,
  CANARY_EXCEPTION,
  CANARY_GEMINI_ERROR,
  CANARY_PAGE_TEXT,
  CANARY_UPLOAD_TOKEN,
  capture,
  JPEG_BYTES,
  MAX_BYTES,
  PAGE_ID,
  post,
  TOKEN_ALICE,
  TOKEN_BOB,
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
