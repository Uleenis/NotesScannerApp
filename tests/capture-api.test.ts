import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import {
  callPrepare,
  callRead,
  fetchAllowance,
  fetchLatestNotebookId,
  insertPage,
  markUploaded,
  parseAllowance,
  uploadPhoto,
  uploadPhotoFile,
  type CaptureClient,
} from "@/capture/api";

type Outcome = { data: unknown; error: unknown };

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
}

function client(parts: Record<string, unknown>): CaptureClient {
  return parts as unknown as CaptureClient;
}

const row = { is_anonymous: false, used: 2, max: 15, remaining: 13, resets_at: "2026-10-31T23:00:00+00:00", blocked_reason: null };

test("an allowance row is read with its blocking reason", () => {
  expect(parseAllowance([row])).toEqual({
    isAnonymous: false,
    used: 2,
    max: 15,
    remaining: 13,
    resetsAt: "2026-10-31T23:00:00+00:00",
    blockedReason: null,
  });
  expect(parseAllowance([{ ...row, blocked_reason: "monthly_limit" }])?.blockedReason).toBe("monthly_limit");
  expect(parseAllowance({ ...row, blocked_reason: "anonymous_daily_cap" })?.blockedReason).toBe("anonymous_daily_cap");
});

test("an allowance that cannot be read is no allowance, and an unknown reason never blocks", () => {
  expect(parseAllowance([])).toBeNull();
  expect(parseAllowance(null)).toBeNull();
  expect(parseAllowance([{ ...row, used: "many" }])).toBeNull();
  expect(parseAllowance([{ ...row, blocked_reason: "something_new" }])?.blockedReason).toBeNull();
});

test("the allowance is read by the function the database gives the user, with no argument", async () => {
  const rpc = jest.fn(async (): Promise<Outcome> => ({ data: [row], error: null }));
  const allowance = await fetchAllowance(client({ rpc }));

  expect(rpc).toHaveBeenCalledWith("my_page_allowance");
  expect(allowance?.max).toBe(15);
});

test("an allowance request that fails is an error, not a missing limit", async () => {
  const rpc = jest.fn(async (): Promise<Outcome> => ({ data: null, error: { message: "boom" } }));
  await expect(fetchAllowance(client({ rpc }))).rejects.toThrow();
});

function pagesClient(outcome: Outcome) {
  const limit = jest.fn(async () => outcome);
  const order = jest.fn(() => ({ limit }));
  const not = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ not, order }));
  const insertSingle = jest.fn(async () => outcome);
  const insert = jest.fn(() => ({ select: () => ({ single: insertSingle }) }));
  const eq = jest.fn(async () => outcome);
  const update = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select, insert, update }));
  return { from, select, not, order, limit, insert, update, eq };
}

test("the last notebook used is the one of the most recent page", async () => {
  const fake = pagesClient({ data: [{ notebook_id: "notebook-7" }], error: null });
  const id = await fetchLatestNotebookId(client(fake));

  expect(fake.from).toHaveBeenCalledWith("pages");
  expect(fake.select).toHaveBeenCalledWith("notebook_id");
  expect(fake.not).toHaveBeenCalledWith("uploaded_at", "is", null);
  expect(fake.order).toHaveBeenCalledWith("captured_at", { ascending: false });
  expect(fake.limit).toHaveBeenCalledWith(1);
  expect(id).toBe("notebook-7");
});

test("with no page yet there is no last notebook", async () => {
  expect(await fetchLatestNotebookId(client(pagesClient({ data: [], error: null })))).toBeNull();
});

test("a failed read of the last notebook is an error", async () => {
  await expect(fetchLatestNotebookId(client(pagesClient({ data: null, error: { message: "boom" } })))).rejects.toThrow();
});

test("a page is created with its notebook, its source and its moment, and nothing else", async () => {
  const fake = pagesClient({ data: { id: "page-1" }, error: null });
  const result = await insertPage(client(fake), "notebook-1", "2026-10-06T10:00:00.000Z");

  expect(fake.insert).toHaveBeenCalledWith({ notebook_id: "notebook-1", source: "camera", captured_at: "2026-10-06T10:00:00.000Z" });
  expect(result).toEqual({ status: "created", pageId: "page-1" });
});

test("a page that cannot be created is a failure, a lost network is a network failure", async () => {
  expect(await insertPage(client(pagesClient({ data: null, error: { code: "42501", message: "denied" } })), "n", "t")).toEqual({
    status: "failed",
  });
  expect(await insertPage(client(pagesClient({ data: null, error: { message: "TypeError: Network request failed" } })), "n", "t")).toEqual({
    status: "network",
  });
  const throwing = { from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.reject(new TypeError("Network request failed")) }) }) }) };
  expect(await insertPage(client(throwing), "n", "t")).toEqual({ status: "network" });
});

function functionsClient(outcome: Outcome) {
  const invoke = jest.fn(async () => outcome);
  return { functions: { invoke }, invoke };
}

test("preparing a page asks the server with the page id alone and keeps the path and the token", async () => {
  const fake = functionsClient({ data: { path: "u/p/original.jpg", token: "t", signed_url: "http://x" }, error: null });
  const result = await callPrepare(client(fake), "page-1");

  expect(fake.invoke).toHaveBeenCalledWith("prepare-page", { body: { page_id: "page-1" } });
  expect(result).toEqual({ status: "ready", path: "u/p/original.jpg", token: "t" });
});

test("an answer of the server without a path and a token is a failure", async () => {
  expect(await callPrepare(client(functionsClient({ data: { path: "u/p" }, error: null })), "p")).toEqual({ status: "failed" });
  expect(await callPrepare(client(functionsClient({ data: null, error: null })), "p")).toEqual({ status: "failed" });
});

test("each refusal of the server while preparing is translated by its code", async () => {
  const cases: [number, string, unknown][] = [
    [409, "photo_exists", { status: "exists" }],
    [409, "page_processing", { status: "processing" }],
    [409, "page_already_read", { status: "read" }],
    [409, "page_failed", { status: "failed" }],
    [403, "monthly_limit", { status: "limit", reason: "monthly_limit" }],
    [403, "anonymous_limit", { status: "limit", reason: "anonymous_limit" }],
    [403, "anonymous_daily_cap", { status: "limit", reason: "anonymous_daily_cap" }],
    [404, "page_not_found", { status: "failed" }],
    [401, "unauthenticated", { status: "failed" }],
    [500, "internal_error", { status: "failed" }],
  ];
  for (const [status, code, expected] of cases) {
    const result = await callPrepare(client(functionsClient({ data: null, error: httpError(status, { error: code }) })), "p");
    expect(result).toEqual(expected);
  }
});

test("a refusal whose body cannot be read is a failure", async () => {
  const broken = new FunctionsHttpError(new Response("not json", { status: 409 }));
  expect(await callPrepare(client(functionsClient({ data: null, error: broken })), "p")).toEqual({ status: "failed" });
});

test("a request that never reaches the server is a network failure", async () => {
  const lost = functionsClient({ data: null, error: new FunctionsFetchError(new TypeError("Network request failed")) });
  expect(await callPrepare(client(lost), "p")).toEqual({ status: "network" });
  const thrown = { functions: { invoke: () => Promise.reject(new TypeError("Network request failed")) } };
  expect(await callPrepare(client(thrown), "p")).toEqual({ status: "network" });
});

test("starting the reading calls read-page with the page id alone and never throws", async () => {
  const fake = functionsClient({ data: { status: "read" }, error: null });
  await callRead(client(fake), "page-1");
  expect(fake.invoke).toHaveBeenCalledWith("read-page", { body: { page_id: "page-1" } });

  await expect(callRead(client(functionsClient({ data: null, error: httpError(403, { error: "monthly_limit" }) })), "p")).resolves.toBeUndefined();
  await expect(callRead(client({ functions: { invoke: () => Promise.reject(new TypeError("Network request failed")) } }), "p")).resolves.toBeUndefined();
});

function storageClient(outcome: Outcome) {
  const uploadToSignedUrl = jest.fn(async () => outcome);
  const from = jest.fn(() => ({ uploadToSignedUrl }));
  return { storage: { from }, from, uploadToSignedUrl };
}

const BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

test("the photo is uploaded to the prepared path with its token, as a JPEG", async () => {
  const fake = storageClient({ data: { path: "p" }, error: null });
  const result = await uploadPhoto(client(fake), "u/p/original.jpg", "token", BYTES);

  expect(fake.from).toHaveBeenCalledWith("photos");
  expect(fake.uploadToSignedUrl).toHaveBeenCalledWith("u/p/original.jpg", "token", BYTES, { contentType: "image/jpeg" });
  expect(result).toBe("uploaded");
});

test("a photo the storage refuses for its size is too large, for its type is refused, other failures are failures", async () => {
  const tooLarge = storageClient({ data: null, error: { statusCode: "413", message: "refused" } });
  expect(await uploadPhoto(client(tooLarge), "p", "t", BYTES)).toBe("tooLarge");
  const wrongType = storageClient({ data: null, error: { statusCode: "415", message: "refused" } });
  expect(await uploadPhoto(client(wrongType), "p", "t", BYTES)).toBe("refused");
  expect(await uploadPhoto(client(storageClient({ data: null, error: { statusCode: "500", message: "broken" } })), "p", "t", BYTES)).toBe("failed");
  expect(await uploadPhoto(client(storageClient({ data: null, error: { message: "Network request failed" } })), "p", "t", BYTES)).toBe("network");
});

test("a photo over the limit of the storage is not even sent", async () => {
  const fake = storageClient({ data: { path: "p" }, error: null });
  const heavy = new Uint8Array(10 * 1024 * 1024 + 1);

  expect(await uploadPhoto(client(fake), "p", "t", heavy)).toBe("tooLarge");
  expect(fake.uploadToSignedUrl).not.toHaveBeenCalled();
});

test("a photo of exactly the limit is sent", async () => {
  const fake = storageClient({ data: { path: "p" }, error: null });

  expect(await uploadPhoto(client(fake), "p", "t", new Uint8Array(10 * 1024 * 1024))).toBe("uploaded");
});

test("a failure that is a TypeError is a network failure whatever its words", async () => {
  const insertThrows = { from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.reject(new TypeError("Load failed")) }) }) }) };
  expect(await insertPage(client(insertThrows), "n", "t")).toEqual({ status: "network" });
  const prepareThrows = { functions: { invoke: () => Promise.reject(new TypeError("Load failed")) } };
  expect(await callPrepare(client(prepareThrows), "p")).toEqual({ status: "network" });
  const uploadThrows = { storage: { from: () => ({ uploadToSignedUrl: () => Promise.reject(new TypeError("Load failed")) }) } };
  expect(await uploadPhoto(client(uploadThrows), "p", "t", BYTES)).toBe("network");
});

test("a database error with a code is never taken for a network failure", async () => {
  const error = { code: "42501", message: "connection to the database was denied" };
  expect(await insertPage(client(pagesClient({ data: null, error })), "n", "t")).toEqual({ status: "failed" });
});

test("the page is marked as uploaded with the moment, and only that field is written", async () => {
  const fake = pagesClient({ data: null, error: null });
  const result = await markUploaded(client(fake), "page-1", "2026-10-06T10:00:00.000Z");

  expect(fake.from).toHaveBeenCalledWith("pages");
  expect(fake.update).toHaveBeenCalledWith({ uploaded_at: "2026-10-06T10:00:00.000Z" });
  expect(fake.eq).toHaveBeenCalledWith("id", "page-1");
  expect(result).toBe("marked");
});

test("a page that cannot be marked is a failure, a lost network is a network failure", async () => {
  expect(await markUploaded(client(pagesClient({ data: null, error: { code: "42501", message: "denied" } })), "p", "t")).toBe("failed");
  expect(await markUploaded(client(pagesClient({ data: null, error: { message: "TypeError: Network request failed" } })), "p", "t")).toBe("network");
  const throwing = { from: () => ({ update: () => ({ eq: () => Promise.reject(new TypeError("Network request failed")) }) }) };
  expect(await markUploaded(client(throwing), "p", "t")).toBe("network");
});

function photoFile(bytes: () => Promise<Uint8Array>) {
  const remove = jest.fn();
  return { file: { bytes, delete: remove }, remove };
}

test("the file of the photo is deleted once the photo is uploaded", async () => {
  const fake = storageClient({ data: { path: "p" }, error: null });
  const { file, remove } = photoFile(async () => BYTES);

  expect(await uploadPhotoFile(client(fake), file, "u/p/original.jpg", "token")).toBe("uploaded");
  expect(fake.uploadToSignedUrl).toHaveBeenCalledWith("u/p/original.jpg", "token", BYTES, { contentType: "image/jpeg" });
  expect(remove).toHaveBeenCalledTimes(1);
});

test("the file of the photo is kept when the upload fails, so the next try can send it again", async () => {
  for (const error of [{ statusCode: "500", message: "broken" }, { statusCode: "413", message: "big" }, { message: "Network request failed" }]) {
    const { file, remove } = photoFile(async () => BYTES);
    await uploadPhotoFile(client(storageClient({ data: null, error })), file, "p", "t");

    expect(remove).not.toHaveBeenCalled();
  }
});

test("a file that cannot be deleted does not turn a sent photo into a failure", async () => {
  const { file, remove } = photoFile(async () => BYTES);
  remove.mockImplementation(() => {
    throw new Error("already gone");
  });

  expect(await uploadPhotoFile(client(storageClient({ data: { path: "p" }, error: null })), file, "p", "t")).toBe("uploaded");
});

test("a file that cannot be read is a failure and nothing is uploaded", async () => {
  const fake = storageClient({ data: { path: "p" }, error: null });
  const { file } = photoFile(async () => Promise.reject(new Error("gone")));

  expect(await uploadPhotoFile(client(fake), file, "p", "t")).toBe("failed");
  expect(fake.uploadToSignedUrl).not.toHaveBeenCalled();
});
