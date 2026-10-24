import {
  MAX_ARCHIVE_PAGES,
  planMyData,
  writeMyData,
  type ArchiveDeps,
  type MyDataPlan,
  type PhotoSource,
  type SavedArchive,
} from "@/export/data/archive";
import { ArchiveTooLargeError, type ArchiveSink } from "@/export/data/zip";
import { fakeArchiveClient, type Row } from "./fake-archive-client";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER = "bbbbbbbb-0000-0000-0000-000000000002";
const page = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const identity = { userId: ME, email: "me@example.test", isAnonymous: false };

type Entry = string | Uint8Array;

function fakeSink(options: { tooLargeAt?: string } = {}) {
  const entries = new Map<string, Entry>();
  const state = { finished: false, aborted: false, discarded: false };
  const sink: ArchiveSink = {
    addText(name, content) {
      if (options.tooLargeAt === name) {
        throw new ArchiveTooLargeError();
      }
      entries.set(name, content);
    },
    addBinary(name, chunks) {
      if (options.tooLargeAt === name) {
        throw new ArchiveTooLargeError();
      }
      const parts = [...chunks];
      const all = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        all.set(part, offset);
        offset += part.length;
      }
      entries.set(name, all);
    },
    written: () => 0,
    finish: () => {
      state.finished = true;
    },
    abort: () => {
      state.aborted = true;
    },
  };
  const saved: SavedArchive = { sink, uri: "file:///cache/export-x/data.zip", discard: () => (state.discarded = true) };
  return { entries, state, saved };
}

function json(entries: Map<string, Entry>, name: string): any {
  const entry = entries.get(name);
  if (typeof entry !== "string") {
    throw new Error(`no text entry ${name}`);
  }
  return JSON.parse(entry);
}

function world(extra: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    profiles: [
      { id: ME, interface_language: "fr", tier: "free" },
      { id: OTHER, interface_language: "en", tier: "subscriber" },
    ],
    notebooks: [
      { id: "nb1", user_id: ME, name: "Histoire", position: 0, correction_level: "course" },
      { id: "nb2", user_id: OTHER, name: "Secret", position: 0, correction_level: "course" },
    ],
    chapters: [
      { id: "ch1", user_id: ME, notebook_id: "nb1", name: "Moyen Âge", position: 0 },
      { id: "ch2", user_id: OTHER, notebook_id: "nb2", name: "Autre", position: 0 },
    ],
    lexicon_entries: [
      { notebook_id: "nb1", user_id: ME, form_key: "magellan", form: "Magellan", occurrences: 2, confirmed: false },
      { notebook_id: "nb2", user_id: OTHER, form_key: "autre", form: "Autre", occurrences: 2, confirmed: false },
    ],
    page_charges: [
      { id: "c1", user_id: ME, page_id: page(1), charged_at: "2026-10-01T10:00:00Z" },
      { id: "c2", user_id: OTHER, page_id: page(9), charged_at: "2026-10-02T10:00:00Z" },
    ],
    pages: [
      { id: page(1), user_id: ME, notebook_id: "nb1", chapter_id: "ch1", position: 0, source: "camera", status: "read", queue_reason: null, retry_count: 0, captured_at: "2026-10-01T09:00:00Z", uploaded_at: "2026-10-01T09:01:00Z", read_at: "2026-10-01T09:02:00Z", page_type: "text", language: "fr" },
      { id: page(2), user_id: ME, notebook_id: "nb1", chapter_id: null, position: 1, source: "camera", status: "failed", queue_reason: null, retry_count: 3, captured_at: "2026-10-02T09:00:00Z", uploaded_at: null, read_at: null, page_type: "text", language: null },
      { id: page(9), user_id: OTHER, notebook_id: "nb2", chapter_id: null, position: 0, source: "camera", status: "read", queue_reason: null, retry_count: 0, captured_at: "2026-10-03T09:00:00Z", uploaded_at: null, read_at: null, page_type: "text", language: "en" },
    ],
    page_images: [
      { id: "i1", user_id: ME, page_id: page(1), kind: "original", storage_path: `${ME}/${page(1)}/original.jpg` },
      { id: "i2", user_id: ME, page_id: page(1), kind: "prepared", storage_path: `${ME}/${page(1)}/prepared.jpg` },
      { id: "i3", user_id: ME, page_id: page(2), kind: "original", storage_path: `${ME}/${page(2)}/original.jpg` },
      { id: "i9", user_id: OTHER, page_id: page(9), kind: "original", storage_path: `${OTHER}/${page(9)}/original.jpg` },
    ],
    readings: [
      { id: "r1", user_id: ME, page_id: page(1), label: "B1", raw_text: "Magelan partit", model: "gemini", model_version: "3.6", prompt_version: "V0", thinking_budget: 0, input_tokens: 10, output_tokens: 5, duration_ms: 900 },
      { id: "r2", user_id: ME, page_id: page(1), label: "B2", raw_text: "Magellan partit", model: "gemini", model_version: "3.6", prompt_version: "V0", thinking_budget: 0, input_tokens: 10, output_tokens: 5, duration_ms: 800 },
      { id: "r9", user_id: OTHER, page_id: page(9), label: "B1", raw_text: "secret", model: "gemini", model_version: "3.6", prompt_version: "V0", thinking_budget: 0, input_tokens: 1, output_tokens: 1, duration_ms: 1 },
    ],
    page_texts: [
      { page_id: page(1), user_id: ME, text: "Magellan partit", pipeline_version: "p1" },
      { page_id: page(9), user_id: OTHER, text: "secret", pipeline_version: "p1" },
    ],
    page_tokens: [
      { page_id: page(1), user_id: ME, token_index: 0, line_index: 0, text: "Magellan", rule: 2, channel: "layer", reading_a: "Magellan", reading_b1: "Magelan", reading_b2: "Magellan", review_status: "corrected", anchor_kind: "word", anchor: [1, 2, 3, 4], b1_start: 0, b1_end: 7 },
      { page_id: page(9), user_id: OTHER, token_index: 0, line_index: 0, text: "secret", rule: null, channel: null, reading_a: null, reading_b1: "secret", reading_b2: null, review_status: null, anchor_kind: null, anchor: null, b1_start: 0, b1_end: 6 },
    ],
    corrections: [
      { id: "k1", user_id: ME, page_id: page(1), token_index: 0, revision: 1, previous_text: "Magelan", corrected_text: "Magellan", chosen_from: "keyboard", from_queue: false, created_at: "2026-10-01T10:00:00Z" },
    ],
    page_gaps: [{ page_id: page(1), user_id: ME, gap_index: 0, text: "ajout" }],
    page_alerts: [{ id: "a1", user_id: ME, page_id: page(1), kind: "missing_line", details: { count: 1 }, created_at: "2026-10-01T10:00:00Z" }],
    ...extra,
  };
  return tables;
}

function deps(overrides: Partial<ArchiveDeps> = {}, sinkOptions: { tooLargeAt?: string } = {}) {
  const fake = fakeSink(sinkOptions);
  const client = fakeArchiveClient(world());
  const photos: string[] = [];
  const disposed: string[] = [];
  const shared: string[] = [];
  const value: ArchiveDeps = {
    client: client.client,
    open: () => fake.saved,
    photo: async (path): Promise<PhotoSource | null> => {
      photos.push(path);
      return { chunks: () => [new Uint8Array([1, 2]), new Uint8Array([3])], dispose: () => void disposed.push(path) };
    },
    share: async (uri) => {
      shared.push(uri);
      return true;
    },
    freeSpace: () => 10_000_000_000,
    now: () => new Date("2026-10-24T12:00:00Z"),
    fileName: "notes-data",
    readme: "README TEXT",
    allowance: { isAnonymous: false, used: 4, max: 15, remaining: 11, resetsAt: "2026-11-01T00:00:00Z", blockedReason: null },
    ...overrides,
  };
  return { value, fake, client, photos, disposed, shared };
}

async function planned(client = fakeArchiveClient(world()).client): Promise<MyDataPlan> {
  const result = await planMyData(client, identity, { cancelled: false });
  if (result.status !== "ready") {
    throw new Error(result.status);
  }
  return result.plan;
}

describe("writeMyData", () => {
  test("writes every listed element for every page, and the account files", async () => {
    const d = deps();
    const plan = await planned(d.client.client);

    const result = await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(result).toEqual({ status: "shared" });
    expect([...d.fake.entries.keys()].sort()).toEqual(
      [
        "README.txt",
        "export.json",
        "notebooks.json",
        `pages/${page(1)}/original.jpg`,
        `pages/${page(1)}/page.json`,
        `pages/${page(1)}/prepared.jpg`,
        `pages/${page(1)}/text.txt`,
        `pages/${page(2)}/original.jpg`,
        `pages/${page(2)}/page.json`,
        "profile.json",
        "usage.json",
      ].sort(),
    );
    expect(d.fake.entries.get("README.txt")).toBe("README TEXT");
    expect(d.fake.entries.get(`pages/${page(1)}/text.txt`)).toBe("Magellan partit");
    expect([...(d.fake.entries.get(`pages/${page(1)}/original.jpg`) as Uint8Array)]).toEqual([1, 2, 3]);

    const first = json(d.fake.entries, `pages/${page(1)}/page.json`);
    expect(first.page).toMatchObject({ id: page(1), status: "read", page_type: "text", language: "fr", captured_at: "2026-10-01T09:00:00Z" });
    expect(first.text).toEqual({ pipeline_version: "p1" });
    expect(first.readings.map((r: Row) => [r.label, r.raw_text, r.model, r.model_version, r.prompt_version])).toEqual([
      ["B1", "Magelan partit", "gemini", "3.6", "V0"],
      ["B2", "Magellan partit", "gemini", "3.6", "V0"],
    ]);
    expect(first.tokens).toHaveLength(1);
    expect(first.tokens[0]).toMatchObject({ reading_a: "Magellan", reading_b1: "Magelan", reading_b2: "Magellan", anchor: [1, 2, 3, 4] });
    expect(first.corrections).toEqual([expect.objectContaining({ previous_text: "Magelan", corrected_text: "Magellan" })]);
    expect(first.edited_text).toEqual([{ gap_index: 0, text: "ajout" }]);
    expect(first.alerts).toEqual([expect.objectContaining({ kind: "missing_line" })]);
    expect(first.images).toEqual([
      { kind: "original", file: "original.jpg" },
      { kind: "prepared", file: "prepared.jpg" },
    ]);

    const second = json(d.fake.entries, `pages/${page(2)}/page.json`);
    expect(second.readings).toEqual([]);
    expect(second.images).toEqual([{ kind: "original", file: "original.jpg" }]);

    expect(json(d.fake.entries, "profile.json")).toEqual({ id: ME, email: "me@example.test", is_anonymous: false, interface_language: "fr", tier: "free" });
    expect(json(d.fake.entries, "usage.json")).toEqual({
      allowance: { used: 4, max: 15, remaining: 11, resets_at: "2026-11-01T00:00:00Z" },
      charges: [{ id: "c1", page_id: page(1), charged_at: "2026-10-01T10:00:00Z" }],
    });
    const library = json(d.fake.entries, "notebooks.json");
    expect(library.notebooks).toEqual([{ id: "nb1", name: "Histoire", position: 0, correction_level: "course" }]);
    expect(library.chapters).toEqual([{ id: "ch1", notebook_id: "nb1", name: "Moyen Âge", position: 0 }]);
    expect(library.lexicon).toEqual([{ notebook_id: "nb1", form_key: "magellan", form: "Magellan", occurrences: 2, confirmed: false }]);
    expect(json(d.fake.entries, "export.json")).toEqual({
      format_version: 1,
      exported_at: "2026-10-24T12:00:00.000Z",
      notebooks: 1,
      chapters: 1,
      pages: 2,
      photos: 3,
      photos_missing: 0,
    });
    expect(d.fake.state.finished).toBe(true);
    expect(d.shared).toEqual(["file:///cache/export-x/data.zip"]);
    expect(d.fake.state.discarded).toBe(false);
  });

  test("contains nothing of another account and never a user identifier column", async () => {
    const d = deps();
    const plan = await planned(d.client.client);

    await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    const everything = [...d.fake.entries.entries()].filter(([, entry]) => typeof entry === "string").map(([, entry]) => entry as string).join("\n");
    expect(everything).not.toContain("secret");
    expect(everything).not.toContain("Secret");
    expect(everything).not.toContain(OTHER);
    expect(everything).not.toContain(page(9));
    expect(d.photos.every((path) => path.startsWith(`${ME}/`))).toBe(true);
    expect(everything).not.toContain('"user_id"');
    for (const query of d.client.queries) {
      const owner = query.filters.find(([column]) => column === "user_id" || (column === "id" && query.table === "profiles"));
      expect(owner).toEqual([expect.any(String), ME]);
    }
  });

  test("drops rows of pages it did not ask for, whatever the server returns", async () => {
    const leaky = fakeArchiveClient(world(), { leaky: true });
    const plan: MyDataPlan = { identity, pages: [{ id: page(1) }], estimate: 0 };
    const d = deps({ client: leaky.client });

    await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    const text = [...d.fake.entries.values()].filter((entry) => typeof entry === "string").join("\n");
    expect(text).not.toContain("secret");
    expect(d.photos).toEqual([`${ME}/${page(1)}/original.jpg`, `${ME}/${page(1)}/prepared.jpg`]);
  });

  test("reads the page tables in groups of at most 20 pages", async () => {
    const many = Array.from({ length: 45 }, (_, index) => ({ id: page(100 + index), user_id: ME, notebook_id: "nb1", chapter_id: null, position: index, source: "camera", status: "failed", queue_reason: null, retry_count: 0, captured_at: "2026-10-01T09:00:00Z", uploaded_at: null, read_at: null, page_type: "text", language: null }));
    const fake = fakeArchiveClient(world({ pages: many }));
    const d = deps({ client: fake.client });
    const plan = await planned(fake.client);

    await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    const readings = fake.queries.filter((query) => query.table === "readings");
    expect(readings).toHaveLength(3);
    for (const query of readings) {
      const ids = query.filters.find(([column]) => column === "page_id")?.[1] as string[];
      expect(ids.length).toBeLessThanOrEqual(20);
    }
  });

  test("reads past the 1000 rows of a request", async () => {
    const tokens = Array.from({ length: 2300 }, (_, index) => ({ page_id: page(1), user_id: ME, token_index: index, line_index: 0, text: "w", rule: null, channel: null, reading_a: null, reading_b1: "w", reading_b2: null, review_status: null, anchor_kind: null, anchor: null, b1_start: 0, b1_end: 1 }));
    const fake = fakeArchiveClient(world({ page_tokens: tokens }));
    const d = deps({ client: fake.client });
    const plan = await planned(fake.client);

    await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    const read = json(d.fake.entries, `pages/${page(1)}/page.json`).tokens as Row[];
    expect(read).toHaveLength(2300);
    expect(read.map((token) => token.token_index)).toEqual(Array.from({ length: 2300 }, (_, index) => index));
  });

  test("notes a photo that is gone and goes on", async () => {
    const d = deps({
      photo: async (path) => (path.endsWith("prepared.jpg") ? null : { chunks: () => [new Uint8Array([9])], dispose: () => undefined }),
    });
    const plan = await planned(d.client.client);

    const result = await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(result).toEqual({ status: "shared" });
    expect(json(d.fake.entries, `pages/${page(1)}/page.json`).images).toEqual([
      { kind: "original", file: "original.jpg" },
      { kind: "prepared", file: null },
    ]);
    expect(d.fake.entries.has(`pages/${page(1)}/prepared.jpg`)).toBe(false);
    expect(json(d.fake.entries, "export.json")).toMatchObject({ photos: 3, photos_missing: 1 });
  });

  test("does not fetch a photo that is not in the folder of its page", async () => {
    const strange = world({
      page_images: [{ id: "i1", user_id: ME, page_id: page(1), kind: "original", storage_path: `${OTHER}/${page(9)}/original.jpg` }],
    });
    const fake = fakeArchiveClient(strange);
    const d = deps({ client: fake.client });
    const plan = await planned(fake.client);

    await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(d.photos).toEqual([]);
    expect(json(d.fake.entries, `pages/${page(1)}/page.json`).images).toEqual([{ kind: "original", file: null }]);
  });

  test("a photo that cannot be fetched fails the export and erases the archive", async () => {
    const d = deps({
      photo: async () => {
        throw new Error("network");
      },
    });
    const plan = await planned(d.client.client);

    const result = await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(result).toEqual({ status: "error" });
    expect(d.fake.state.aborted).toBe(true);
    expect(d.fake.state.discarded).toBe(true);
    expect(d.shared).toEqual([]);
  });

  test("a failing read fails the export and erases the archive", async () => {
    const fake = fakeArchiveClient(world(), { failTable: "readings" });
    const d = deps({ client: fake.client });
    const plan = await planned(fake.client);

    const result = await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(result).toEqual({ status: "error" });
    expect(d.fake.state.discarded).toBe(true);
  });

  test("an interrupted export is erased, nothing is shared", async () => {
    const control = { cancelled: false };
    const d = deps({
      photo: async (path) => {
        control.cancelled = true;
        return { chunks: () => [new Uint8Array([1])], dispose: () => void d.disposed.push(path) };
      },
    });
    const plan = await planned(d.client.client);

    const result = await writeMyData(plan, d.value, control, () => undefined);

    expect(result).toEqual({ status: "cancelled" });
    expect(d.fake.state.aborted).toBe(true);
    expect(d.fake.state.discarded).toBe(true);
    expect(d.shared).toEqual([]);
    expect(d.fake.entries.has(`pages/${page(1)}/prepared.jpg`)).toBe(false);
  });

  test("an error after a cancel is a cancel", async () => {
    const control = { cancelled: false };
    const d = deps({
      photo: async () => {
        control.cancelled = true;
        throw new Error("boom");
      },
    });
    const plan = await planned(d.client.client);

    expect(await writeMyData(plan, d.value, control, () => undefined)).toEqual({ status: "cancelled" });
  });

  test("disposes each photo source, even when writing it fails", async () => {
    const d = deps({}, { tooLargeAt: `pages/${page(1)}/original.jpg` });
    const plan = await planned(d.client.client);

    await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(d.disposed).toEqual([`${ME}/${page(1)}/original.jpg`]);
  });

  test("an archive over the size limit is refused and erased", async () => {
    const d = deps({}, { tooLargeAt: "usage.json" });
    const plan = await planned(d.client.client);

    const result = await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(result).toEqual({ status: "tooLarge" });
    expect(d.fake.state.discarded).toBe(true);
  });

  test("refuses to start without room for the estimated size", async () => {
    const d = deps({ freeSpace: () => 10_000_000 });
    const plan: MyDataPlan = { ...(await planned(d.client.client)), estimate: 500_000_000 };

    const result = await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(result).toEqual({ status: "noSpace" });
    expect(d.fake.entries.size).toBe(0);
    expect(d.shared).toEqual([]);
  });

  test("erases the archive when sharing is not available, keeps it once shared", async () => {
    const d = deps({ share: async () => false });
    const plan = await planned(d.client.client);

    expect(await writeMyData(plan, d.value, { cancelled: false }, () => undefined)).toEqual({ status: "unavailable" });
    expect(d.fake.state.discarded).toBe(true);
  });

  test("erases the archive when the sheet fails", async () => {
    const d = deps({
      share: async () => {
        throw new Error("sheet");
      },
    });
    const plan = await planned(d.client.client);

    expect(await writeMyData(plan, d.value, { cancelled: false }, () => undefined)).toEqual({ status: "error" });
    expect(d.fake.state.discarded).toBe(true);
  });

  test("reports the progress page by page", async () => {
    const d = deps();
    const plan = await planned(d.client.client);
    const seen: [number, number][] = [];

    await writeMyData(plan, d.value, { cancelled: false }, (done, total) => seen.push([done, total]));

    expect(seen).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  test("an account with no page still gets its files", async () => {
    const fake = fakeArchiveClient(world({ pages: [], page_images: [] }));
    const d = deps({ client: fake.client });
    const plan = await planned(fake.client);

    expect(await writeMyData(plan, d.value, { cancelled: false }, () => undefined)).toEqual({ status: "shared" });
    expect([...d.fake.entries.keys()].sort()).toEqual(["README.txt", "export.json", "notebooks.json", "profile.json", "usage.json"]);
  });

  test("an anonymous account without allowance is written with a null allowance", async () => {
    const d = deps({ allowance: null });
    const plan = await planned(d.client.client);

    await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(json(d.fake.entries, "usage.json").allowance).toBeNull();
  });

  test("text with markup is kept as it is, inside the text file and the JSON", async () => {
    const hostile = "<script>alert(1)</script> ../../x </style>";
    const fake = fakeArchiveClient(world({ page_texts: [{ page_id: page(1), user_id: ME, text: hostile, pipeline_version: "p1" }] }));
    const d = deps({ client: fake.client });
    const plan = await planned(fake.client);

    await writeMyData(plan, d.value, { cancelled: false }, () => undefined);

    expect(d.fake.entries.get(`pages/${page(1)}/text.txt`)).toBe(hostile);
  });
});

describe("planMyData", () => {
  test("lists the pages and estimates the size from a sample of page folders", async () => {
    const folders = Object.fromEntries(
      [1, 2].map((n) => [
        `${ME}/${page(n)}`,
        [
          { name: "original.jpg", metadata: { size: 3_000_000 } },
          { name: "prepared.jpg", metadata: { size: 1_000_000 } },
        ],
      ]),
    );
    const fake = fakeArchiveClient(world(), { folders });

    const result = await planMyData(fake.client, identity, { cancelled: false });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.plan.pages.map((row) => row.id)).toEqual([page(1), page(2)]);
      expect(result.plan.estimate).toBe(8_000_000);
    }
    expect(fake.listed).toEqual([`photos/${ME}/${page(1)}`, `photos/${ME}/${page(2)}`]);
  });

  test("looks at 8 page folders at most", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ id: page(100 + index), user_id: ME, notebook_id: "nb1", chapter_id: null, position: index, source: "camera", status: "read", queue_reason: null, retry_count: 0, captured_at: "2026-10-01T09:00:00Z", uploaded_at: null, read_at: null, page_type: "text", language: null }));
    const folders = Object.fromEntries(many.map((row) => [`${ME}/${row.id}`, [{ name: "original.jpg", metadata: { size: 1000 } }]]));
    const fake = fakeArchiveClient(world({ pages: many }), { folders });

    const result = await planMyData(fake.client, identity, { cancelled: false });

    expect(fake.listed).toHaveLength(8);
    expect(result.status === "ready" && result.plan.estimate).toBe(30_000);
  });

  test("refuses more pages than the bound", async () => {
    const huge = Array.from({ length: MAX_ARCHIVE_PAGES + 1 }, (_, index) => ({ id: `p${index}`, user_id: ME }));
    const fake = fakeArchiveClient(world({ pages: huge }));

    expect(await planMyData(fake.client, identity, { cancelled: false })).toEqual({ status: "tooMany", max: MAX_ARCHIVE_PAGES });
  });

  test("a failing read is an error", async () => {
    const fake = fakeArchiveClient(world(), { failTable: "pages" });

    expect(await planMyData(fake.client, identity, { cancelled: false })).toEqual({ status: "error" });
  });

  test("a cancel stops the plan", async () => {
    const fake = fakeArchiveClient(world());

    expect(await planMyData(fake.client, identity, { cancelled: true })).toEqual({ status: "cancelled" });
  });
});
