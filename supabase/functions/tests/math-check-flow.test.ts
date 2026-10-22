import { assert, assertEquals } from "jsr:@std/assert@1";
import { MAX_CHECKED_TEXT } from "../_shared/math-check.ts";
import { handleReadPage } from "../read-page/handler.ts";
import { handleSetPageType } from "../set-page-type/handler.ts";
import { ALICE, BOB, CANARY_PAGE_TEXT, DEFAULT_READING, PAGE_ID, post, readJson, TOKEN_ALICE, TOKEN_BOB, World } from "./fakes.ts";

const B1 = { ...DEFAULT_READING, text: `${CANARY_PAGE_TEXT}\n$x^2 = 4$\n$y = 1$` };
const SAME_AS_B1 = { ...DEFAULT_READING, text: `${CANARY_PAGE_TEXT}\nx² = 4\ny=1` };
const LACKS_ONE = { ...DEFAULT_READING, text: `${CANARY_PAGE_TEXT}\n$x^2 = 4$` };
const READS_OTHERWISE = { ...DEFAULT_READING, text: `${CANARY_PAGE_TEXT}\n$x^2 = 4$\n$y = 2$` };

function readPageCall(world: World) {
  return handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), world.readDeps());
}

async function read(world: World, b1: typeof B1, second: Parameters<World["pushSecond"]>[0]): Promise<Response> {
  world.readyPage();
  world.push(b1);
  world.pushSecond(second);
  const response = await readPageCall(world);
  await world.settle();
  return response;
}

function alerts(world: World) {
  return world.mathAlerts.map(({ pageId, onlyB1, onlyB2 }) => [pageId, onlyB1, onlyB2]);
}

Deno.test("two passes that say the same on a page of math raise no alert, whatever their spacing and symbols [10]", async () => {
  const world = new World();
  const response = await read(world, B1, SAME_AS_B1);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.page().pageType, "math");
  assertEquals(alerts(world), []);
  assert(world.logs.some((record) => record.event === "math_checked" && record.fields.code === "complete"));
});

Deno.test("a statement one pass forgot raises the alert of the page, with two counts [10]", async () => {
  const world = new World();
  await read(world, B1, LACKS_ONE);
  assertEquals(alerts(world), [[PAGE_ID, 1, 0]]);
  const other = new World();
  await read(other, { ...B1, text: LACKS_ONE.text }, { ...B1 });
  assertEquals(alerts(other), [[PAGE_ID, 0, 1]]);
});

Deno.test("a statement read otherwise raises the alert on both sides [10]", async () => {
  const world = new World();
  await read(world, B1, READS_OTHERWISE);
  assertEquals(alerts(world), [[PAGE_ID, 1, 1]]);
});

Deno.test("the page is read as B1 arrives, and the check waits for B2 in the background [10]", async () => {
  const world = new World();
  world.readyPage();
  world.push(B1);
  world.pushSecond("hold");
  const response = await readPageCall(world);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(alerts(world), []);
  world.releaseSecond(LACKS_ONE);
  await world.settle();
  assertEquals(alerts(world), [[PAGE_ID, 1, 0]]);
});

Deno.test("a B2 that failed leaves the page with no alert and no check [10]", async () => {
  const world = new World();
  world.readyPage();
  world.push(B1);
  world.pushSecond(world.failGemini("http_error"), world.failGemini("http_error"));
  await readPageCall(world);
  await world.settle();
  assertEquals(alerts(world), []);
  assert(!world.calls.includes("mathCheckReadings"));
  assertEquals(world.page().status, "read");
});

Deno.test("a page of text raises no alert of math, however far its passes differ [10]", async () => {
  const world = new World();
  await read(world, { ...DEFAULT_READING, text: "Bonjour Paul" }, { ...DEFAULT_READING, text: "Bonsoir Pablo" });
  assertEquals(world.page().pageType, "text");
  assertEquals(alerts(world), []);
});

Deno.test("a page switched to math before B2 arrives is checked when B2 arrives [10]", async () => {
  const world = new World();
  world.readyPage();
  world.push({ ...DEFAULT_READING, text: "Bonjour Paul" });
  world.pushSecond("hold");
  await readPageCall(world);
  world.page().pageType = "math";
  world.releaseSecond({ ...DEFAULT_READING, text: "$a = 1$" });
  await world.settle();
  assertEquals(alerts(world), [[PAGE_ID, 1, 1]]);
});

Deno.test("two passes too long to compare in a bounded time are not compared, and the page is read all the same [10]", async () => {
  const world = new World();
  const long = { ...B1, text: `$x = 1$\n${"x + 1 ".repeat(MAX_CHECKED_TEXT / 6 + 10)}` };
  const response = await read(world, long, long);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(alerts(world), []);
  assert(world.logs.some((record) => record.event === "math_checked" && record.fields.code === "skipped"));
});

Deno.test("a check that fails changes nothing about the reading, and is logged without a word of the page [10]", async () => {
  const world = new World();
  world.failOn.add("recordMathAlert");
  const response = await read(world, B1, LACKS_ONE);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.readings.filter((reading) => reading.label === "B2").length, 1);
  assertEquals(alerts(world), []);
  assert(world.logs.some((record) => record.event === "unexpected_error"));
  assert(!JSON.stringify(world.logs).includes(CANARY_PAGE_TEXT));
});

Deno.test("a check logs its verdict and the page, never a statement of the page [10]", async () => {
  const world = new World();
  await read(world, B1, READS_OTHERWISE);
  const lines = world.logs.filter((record) => record.event === "math_checked");
  assertEquals(lines.map((record) => record.fields), [{ pageId: PAGE_ID, code: "incomplete" }]);
  assert(!JSON.stringify(world.logs).includes(CANARY_PAGE_TEXT));
});

function storedPage(world: World, pageType: "text" | "math", b2: string | null, owner: string = ALICE): void {
  world.addPage(owner, "read");
  world.page().pageType = pageType;
  world.addB1(owner, PAGE_ID, B1.text);
  if (b2 !== null) world.addB2(owner, PAGE_ID, b2);
}

function switchTo(world: World, pageType: "text" | "math", token: string = TOKEN_ALICE) {
  return handleSetPageType(post(token, { page_id: PAGE_ID, page_type: pageType }), world.pageTypeDeps());
}

Deno.test("switching a page to math checks its stored passes, B1 and B2 [10]", async () => {
  const world = new World();
  storedPage(world, "text", LACKS_ONE.text);
  const response = await switchTo(world, "math");
  assertEquals(await readJson(response), { page_type: "math" });
  assertEquals(alerts(world), [[PAGE_ID, 1, 0]]);
});

Deno.test("switching a page to math whose passes agree, or that has no B2, raises nothing [10]", async () => {
  const agreeing = new World();
  storedPage(agreeing, "text", SAME_AS_B1.text);
  await switchTo(agreeing, "math");
  assertEquals(alerts(agreeing), []);
  const alone = new World();
  storedPage(alone, "text", null);
  const response = await switchTo(alone, "math");
  assertEquals(response.status, 200);
  assertEquals(alerts(alone), []);
});

Deno.test("a page already of math is not checked again by a second switch [10]", async () => {
  const world = new World();
  storedPage(world, "math", LACKS_ONE.text);
  await switchTo(world, "math");
  assertEquals(alerts(world), []);
  assert(!world.calls.includes("mathCheckReadings"));
});

Deno.test("switching back to text takes the alert of math away [10]", async () => {
  const world = new World();
  storedPage(world, "text", LACKS_ONE.text);
  await switchTo(world, "math");
  assertEquals(alerts(world).length, 1);
  await switchTo(world, "text");
  assertEquals(alerts(world), []);
});

Deno.test("a switch that fails on the check is still a switch, and the check of another's page finds nothing [10]", async () => {
  const world = new World();
  storedPage(world, "text", LACKS_ONE.text);
  world.failOn.add("mathCheckReadings");
  const response = await switchTo(world, "math");
  assertEquals(response.status, 200);
  assertEquals(world.page().pageType, "math");
  const foreign = new World();
  storedPage(foreign, "text", LACKS_ONE.text, BOB);
  const refused = await switchTo(foreign, "math", TOKEN_ALICE);
  assertEquals(refused.status, 404);
  assertEquals(alerts(foreign), []);
  const own = await switchTo(foreign, "math", TOKEN_BOB);
  assertEquals(own.status, 200);
  assertEquals(alerts(foreign), [[PAGE_ID, 1, 0]]);
});
