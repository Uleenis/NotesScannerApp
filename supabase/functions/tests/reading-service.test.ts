import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createReadingService, readingServiceFrom, retryable } from "../_shared/reading-service.ts";
import type { ServiceFailure } from "../_shared/reading-service.ts";
import { ALICE, JPEG_BYTES, PAGE_ID } from "./fakes.ts";

const SECRET = "reading-secret-".repeat(3);
const BASE = "http://notes-reading:8080";
const B1 = "ZEBRA-CANARY-PAGE-TEXT et la suite";

type Seen = { url: URL; method: string | undefined; headers: Headers; body: BodyInit | null | undefined; redirect: RequestRedirect | undefined; signal: AbortSignal | null | undefined };

function recorder(respond: (seen: Seen) => Response | Promise<Response>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = {
      url: new URL(String(input)),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body,
      redirect: init?.redirect,
      signal: init?.signal,
    };
    seen.push(call);
    return Promise.resolve(respond(call));
  };
  return { fetch: fetcher as typeof fetch, seen };
}

function answerOf(pageId: string = PAGE_ID): string {
  return JSON.stringify({
    page_id: pageId,
    width: 1200,
    height: 1600,
    lines: [{ row: 0, box: [10, 20, 400, 60], ink: [12, 22, 398, 58], words: [{ text: "Bonjour", box: [10, 20, 90, 60], confidence: 1.0 }] }],
    alto: "<alto/>",
  });
}

function reply(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function service(fetcher: typeof fetch, options: Partial<{ maxAnswerBytes: number; recognizeTimeoutMs: number; arbitrateTimeoutMs: number }> = {}) {
  return createReadingService({ url: BASE, secret: SECRET, fetch: fetcher, ...options });
}

Deno.test("/recognize gets the photo as it is, its page id and the secret, and nothing of B1 [12]", async () => {
  const { fetch, seen } = recorder(() => reply(200, answerOf()));
  const result = await service(fetch).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal);
  assertEquals(result, { ok: true, answer: answerOf() });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].method, "POST");
  assertEquals(seen[0].url.origin, BASE);
  assertEquals(seen[0].url.pathname, "/recognize");
  assertEquals([...seen[0].url.searchParams], [["page_id", PAGE_ID]]);
  assertEquals(seen[0].headers.get("content-type"), "image/jpeg");
  assertEquals(seen[0].headers.get("x-reading-secret"), SECRET);
  assertEquals(seen[0].headers.get("authorization"), null);
  assertEquals(seen[0].redirect, "manual");
  assertEquals(seen[0].body, JPEG_BYTES);
  assert(!seen[0].url.href.includes("ZEBRA"));
});

Deno.test("/arbitrate gets the page, its owner, B1, the answer of /recognize as it came and the duration", async () => {
  const { fetch, seen } = recorder(() => reply(200, JSON.stringify({ page_id: PAGE_ID, outcome: "recorded", tokens: 7 })));
  const answer = answerOf();
  const result = await service(fetch).arbitrate({ pageId: PAGE_ID, userId: ALICE, b1: B1, answer, durationMs: 26_000 }, new AbortController().signal);
  assertEquals(result, { ok: true, tokens: 7 });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].method, "POST");
  assertEquals(seen[0].url.href, `${BASE}/arbitrate`);
  assertEquals(seen[0].headers.get("content-type"), "application/json");
  assertEquals(seen[0].headers.get("x-reading-secret"), SECRET);
  assertEquals(seen[0].redirect, "manual");
  const body = String(seen[0].body);
  assert(body.includes(answer));
  assertEquals(JSON.parse(body), { page_id: PAGE_ID, user_id: ALICE, b1: B1, duration_ms: 26_000, a: JSON.parse(answer) });
});

Deno.test("an answer of /recognize for another page, or that is not a JSON object, is a bad response", async () => {
  for (const body of [answerOf(ALICE), "not json", "[1, 2]", "null", JSON.stringify({ width: 1 })]) {
    const { fetch } = recorder(() => reply(200, body));
    const result = await service(fetch).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal);
    assertEquals(result, { ok: false, failure: { kind: "bad_response" } }, body);
  }
});

Deno.test("an answer of /recognize above the bound is a bad response", async () => {
  const { fetch } = recorder(() => reply(200, answerOf()));
  const result = await service(fetch, { maxAnswerBytes: 64 }).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal);
  assertEquals(result, { ok: false, failure: { kind: "bad_response" } });
});

Deno.test("a refusal of the service keeps its status and a known code only", async () => {
  const cases: [number, string, ServiceFailure][] = [
    [503, JSON.stringify({ error: "busy" }), { kind: "http_error", status: 503, code: "busy" }],
    [422, JSON.stringify({ error: "too_complex" }), { kind: "http_error", status: 422, code: "too_complex" }],
    [500, JSON.stringify({ error: "ZEBRA-CANARY-PAGE-TEXT" }), { kind: "http_error", status: 500 }],
    [502, "<html>bad gateway</html>", { kind: "http_error", status: 502 }],
    [302, "", { kind: "http_error", status: 302 }],
  ];
  for (const [status, body, failure] of cases) {
    const { fetch } = recorder(() => reply(status, body));
    assertEquals(await service(fetch).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal), { ok: false, failure }, body);
  }
  const refused = recorder(() => reply(409, JSON.stringify({ error: "already_read" })));
  assertEquals(
    await service(refused.fetch).arbitrate({ pageId: PAGE_ID, userId: ALICE, b1: B1, answer: answerOf(), durationMs: 1 }, new AbortController().signal),
    { ok: false, failure: { kind: "http_error", status: 409, code: "already_read" } },
  );
});

Deno.test("a network failure, a timeout and a cancellation are told apart", async () => {
  const broken = (() => Promise.reject(new TypeError("connection refused"))) as typeof fetch;
  assertEquals(await service(broken).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal), { ok: false, failure: { kind: "network" } });

  const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  assertEquals(await service(hanging, { recognizeTimeoutMs: 10 }).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal), {
    ok: false,
    failure: { kind: "timeout" },
  });
  assertEquals(
    await service(hanging, { arbitrateTimeoutMs: 10 }).arbitrate({ pageId: PAGE_ID, userId: ALICE, b1: B1, answer: answerOf(), durationMs: 1 }, new AbortController().signal),
    { ok: false, failure: { kind: "timeout" } },
  );

  const controller = new AbortController();
  const pending = service(hanging).recognize(PAGE_ID, JPEG_BYTES, controller.signal);
  controller.abort();
  assertEquals(await pending, { ok: false, failure: { kind: "cancelled" } });
});

Deno.test("only a failure that may pass on a second try is retried [11]", () => {
  for (const failure of [{ kind: "network" }, { kind: "timeout" }, { kind: "http_error", status: 500 }, { kind: "http_error", status: 503 }, { kind: "http_error", status: 502 }, { kind: "http_error", status: 504 }, { kind: "http_error", status: 429 }] as ServiceFailure[]) {
    assertEquals(retryable(failure), true, JSON.stringify(failure));
  }
  for (const failure of [{ kind: "bad_response" }, { kind: "cancelled" }, { kind: "http_error", status: 302 }, { kind: "http_error", status: 400 }, { kind: "http_error", status: 401 }, { kind: "http_error", status: 409 }, { kind: "http_error", status: 413 }, { kind: "http_error", status: 415 }, { kind: "http_error", status: 422 }] as ServiceFailure[]) {
    assertEquals(retryable(failure), false, JSON.stringify(failure));
  }
});

function env(values: Record<string, string | undefined>): (name: string) => string | undefined {
  return (name) => values[name];
}

Deno.test("without an address and a secret there is no service, and B1 reads alone", () => {
  assertEquals(readingServiceFrom(env({})), null);
});

Deno.test("a half or unsafe configuration of the service stops the function", () => {
  for (const values of [
    { READING_URL: BASE },
    { READING_SECRET: SECRET },
    { READING_URL: BASE, READING_SECRET: "short", SUPABASE_URL: LOCAL_STACK },
    { READING_URL: BASE, READING_SECRET: ` ${SECRET}`, SUPABASE_URL: LOCAL_STACK },
    { READING_URL: "http://reading.example.com", READING_SECRET: SECRET },
    { READING_URL: "ftp://notes-reading", READING_SECRET: SECRET },
    { READING_URL: "https://user:pass@reading.example.com", READING_SECRET: SECRET },
    { READING_URL: "https://reading.example.com/?x=1", READING_SECRET: SECRET },
    { READING_URL: "https://reading.example.com/base", READING_SECRET: SECRET },
    { READING_URL: "not an address", READING_SECRET: SECRET },
  ]) {
    assertThrows(() => readingServiceFrom(env(values)), Error, undefined, JSON.stringify(values.READING_URL));
  }
});

const LOCAL_STACK = "http://kong:8000";

Deno.test("the service is reached over https, or over http on the machine or the network of the local stack", () => {
  for (const url of ["https://reading.example.com", "https://reading.example.com/"]) {
    assert(readingServiceFrom(env({ READING_URL: url, READING_SECRET: SECRET, SUPABASE_URL: "https://project.supabase.co" })) !== null, url);
  }
  for (const url of ["http://localhost:54340", "http://127.0.0.1:54340", "http://[::1]:54340", BASE, `${BASE}/`]) {
    assert(readingServiceFrom(env({ READING_URL: url, READING_SECRET: SECRET, SUPABASE_URL: LOCAL_STACK })) !== null, url);
  }
});

Deno.test("plain http is refused outside the local stack", () => {
  for (const supabaseUrl of ["https://project.supabase.co", undefined]) {
    assertThrows(() => readingServiceFrom(env({ READING_URL: BASE, READING_SECRET: SECRET, SUPABASE_URL: supabaseUrl })), Error);
  }
});

Deno.test("a proxy of the environment would see the secret over http: the function does not start", () => {
  for (const name of ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) {
    assertThrows(() => readingServiceFrom(env({ READING_URL: BASE, READING_SECRET: SECRET, SUPABASE_URL: LOCAL_STACK, [name]: "http://127.0.0.1:3128" })), Error, undefined, name);
  }
  for (const noProxy of ["notes-reading", "localhost,notes-reading", "*", ".notes-reading"]) {
    const values = { READING_URL: BASE, READING_SECRET: SECRET, SUPABASE_URL: LOCAL_STACK, HTTP_PROXY: "http://127.0.0.1:3128", NO_PROXY: noProxy };
    assert(readingServiceFrom(env(values)) !== null, noProxy);
  }
  assert(readingServiceFrom(env({ READING_URL: "https://reading.example.com", READING_SECRET: SECRET, HTTPS_PROXY: "http://127.0.0.1:3128" })) !== null);
});

Deno.test("a trailing slash in the address does not change the routes", async () => {
  const { fetch, seen } = recorder(() => reply(200, answerOf()));
  await createReadingService({ url: `${BASE}/`, secret: SECRET, fetch }).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal);
  assertEquals(seen[0].url.pathname, "/recognize");
});

Deno.test("the time left to A shortens a call, never lengthens it", async () => {
  const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  const started = Date.now();
  assertEquals(await service(hanging).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal, 10), { ok: false, failure: { kind: "timeout" } });
  assertEquals(
    await service(hanging).arbitrate({ pageId: PAGE_ID, userId: ALICE, b1: B1, answer: answerOf(), durationMs: 1 }, new AbortController().signal, 10),
    { ok: false, failure: { kind: "timeout" } },
  );
  assert(Date.now() - started < 5_000);
  assertEquals(await service(hanging, { recognizeTimeoutMs: 10 }).recognize(PAGE_ID, JPEG_BYTES, new AbortController().signal, 60_000), {
    ok: false,
    failure: { kind: "timeout" },
  });
});
