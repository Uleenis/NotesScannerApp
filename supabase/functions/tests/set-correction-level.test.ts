import { assertEquals } from "jsr:@std/assert@1";
import { handleSetCorrectionLevel } from "../set-correction-level/handler.ts";
import { ALICE, BOB, post, readJson, TOKEN_ALICE, World } from "./fakes.ts";

const NOTEBOOK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_NOTEBOOK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function call(world: World, token: string | null, body: unknown) {
  return handleSetCorrectionLevel(post(token, body), world.levelDeps());
}

function setup(): World {
  const world = new World();
  world.addNotebook(ALICE, "Journal", NOTEBOOK);
  world.addNotebook(BOB, "Other", OTHER_NOTEBOOK);
  world.inService.add(ALICE);
  world.inService.add(BOB);
  return world;
}

Deno.test("set-correction-level refuses a request without a token [10]", async () => {
  const world = setup();
  const response = await call(world, null, { notebook_id: NOTEBOOK, level: "journal" });
  assertEquals(response.status, 401);
  assertEquals(await readJson(response), { error: "unauthenticated" });
  assertEquals(world.levelWrites, []);
});

Deno.test("set-correction-level refuses a token that does not belong to an account [10]", async () => {
  const world = setup();
  const response = await call(world, "token-forged", { notebook_id: NOTEBOOK, level: "journal" });
  assertEquals(response.status, 401);
  assertEquals(world.levelWrites, []);
});

Deno.test("set-correction-level refuses anything but a POST [10]", async () => {
  const world = setup();
  const response = await handleSetCorrectionLevel(post(TOKEN_ALICE, "", "GET"), world.levelDeps());
  assertEquals(response.status, 405);
  assertEquals(world.levelWrites, []);
});

Deno.test("set-correction-level takes a body of exactly a notebook and a known level [10]", async () => {
  const bodies: unknown[] = [
    "not json",
    null,
    [NOTEBOOK],
    {},
    { notebook_id: NOTEBOOK },
    { level: "journal" },
    { notebook_id: NOTEBOOK, level: "strict" },
    { notebook_id: NOTEBOOK, level: "JOURNAL" },
    { notebook_id: NOTEBOOK, level: 1 },
    { notebook_id: NOTEBOOK, level: null },
    { notebook_id: "not-a-uuid", level: "journal" },
    { notebook_id: 7, level: "journal" },
    { notebook_id: NOTEBOOK, level: "journal", user_id: BOB },
    { notebook_id: NOTEBOOK, level: "journal", extra: true },
  ];
  for (const body of bodies) {
    const world = setup();
    const response = await call(world, TOKEN_ALICE, body);
    assertEquals(response.status, 400);
    assertEquals(await readJson(response), { error: "invalid_request" });
    assertEquals(world.levelWrites, []);
  }
});

Deno.test("set-correction-level moves a notebook to each level for an account with a model in service [10]", async () => {
  for (const level of ["journal", "grammar", "course"]) {
    const world = setup();
    const response = await call(world, TOKEN_ALICE, { notebook_id: NOTEBOOK, level });
    assertEquals(response.status, 200);
    assertEquals(await readJson(response), { level });
    assertEquals(world.levelWrites, [{ userId: ALICE, notebookId: NOTEBOOK, level }]);
    assertEquals(world.levels.get(NOTEBOOK), level);
  }
});

Deno.test("set-correction-level answers with the notebook the caller named, in lower case [10]", async () => {
  const world = setup();
  const response = await call(world, TOKEN_ALICE, { notebook_id: NOTEBOOK.toUpperCase(), level: "journal" });
  assertEquals(response.status, 200);
  assertEquals(world.levels.get(NOTEBOOK), "journal");
});

Deno.test("set-correction-level refuses journal and grammar without a model in service, and tells why [10]", async () => {
  for (const level of ["journal", "grammar"]) {
    const world = setup();
    world.inService.delete(ALICE);
    const response = await call(world, TOKEN_ALICE, { notebook_id: NOTEBOOK, level });
    assertEquals(response.status, 409);
    assertEquals(await readJson(response), { error: "requires_model" });
    assertEquals(world.levels.get(NOTEBOOK), undefined);
  }
});

Deno.test("set-correction-level puts a notebook back at the course level without a model [10]", async () => {
  const world = setup();
  world.levels.set(NOTEBOOK, "journal");
  world.inService.delete(ALICE);
  const response = await call(world, TOKEN_ALICE, { notebook_id: NOTEBOOK, level: "course" });
  assertEquals(response.status, 200);
  assertEquals(world.levels.get(NOTEBOOK), "course");
});

Deno.test("set-correction-level never touches the notebook of another account [10]", async () => {
  const world = setup();
  const response = await call(world, TOKEN_ALICE, { notebook_id: OTHER_NOTEBOOK, level: "journal" });
  assertEquals(response.status, 404);
  assertEquals(await readJson(response), { error: "notebook_not_found" });
  assertEquals(world.levels.get(OTHER_NOTEBOOK), undefined);
});

Deno.test("set-correction-level answers not found for a notebook that does not exist [10]", async () => {
  const world = setup();
  const response = await call(world, TOKEN_ALICE, { notebook_id: "33333333-3333-4333-8333-333333333333", level: "course" });
  assertEquals(response.status, 404);
});

Deno.test("set-correction-level takes the account from the token and never from the body [10]", async () => {
  const world = setup();
  const response = await call(world, TOKEN_ALICE, { notebook_id: OTHER_NOTEBOOK, level: "journal", user_id: BOB });
  assertEquals(response.status, 400);
  assertEquals(world.levelWrites, []);
});

Deno.test("set-correction-level answers a storage failure with an internal error and logs no identifier [10]", async () => {
  const world = setup();
  world.failOn.add("setCorrectionLevel");
  const response = await call(world, TOKEN_ALICE, { notebook_id: NOTEBOOK, level: "journal" });
  assertEquals(response.status, 500);
  assertEquals(await readJson(response), { error: "internal_error" });
  const logged = JSON.stringify(world.logs);
  assertEquals(logged.includes(NOTEBOOK), false);
  assertEquals(logged.includes(ALICE), false);
});
