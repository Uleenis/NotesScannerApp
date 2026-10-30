import type { Allowance } from "@/capture/allowance";
import type { ExportControl } from "../run";
import {
  ArchiveReadError,
  ArchiveTooManyRowsError,
  ownRows,
  pageRows,
  type ArchiveClient,
  type PageTable,
  type Row,
} from "./read";
import { ArchiveTooLargeError, isIdentifier, type ArchiveSink } from "./zip";

export const MAX_ARCHIVE_PAGES = 10_000;

const PAGES_PER_GROUP = 20;
const SAMPLE_PAGES = 8;
const SPACE_MARGIN_BYTES = 50_000_000;
const FORMAT_VERSION = 1;
const PHOTO_KINDS = ["original", "prepared"] as const;

export type ArchiveIdentity = { userId: string; email: string | null; isAnonymous: boolean };

export type MyDataPlan = { identity: ArchiveIdentity; pages: Row[]; estimate: number };

export type PhotoSource = { chunks: () => Iterable<Uint8Array>; dispose: () => void };

export type SavedArchive = { sink: ArchiveSink; uri: string; discard: () => void };

export type ArchiveDeps = {
  client: ArchiveClient;
  open: (name: string) => SavedArchive;
  photo: (path: string) => Promise<PhotoSource | null>;
  share: (uri: string) => Promise<boolean>;
  freeSpace: () => number;
  now: () => Date;
  fileName: string;
  readme: string;
  allowance: Allowance | null;
};

export type PlanResult =
  | { status: "ready"; plan: MyDataPlan }
  | { status: "tooMany"; max: number }
  | { status: "cancelled" }
  | { status: "error" };

export type MyDataResult =
  | { status: "shared" }
  | { status: "cancelled" }
  | { status: "tooLarge" }
  | { status: "noSpace" }
  | { status: "unavailable" }
  | { status: "error" };

class Cancelled extends Error {}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value ? (value as Record<string, unknown>)[name] : undefined;
}

async function estimateBytes(client: ArchiveClient, userId: string, pageIds: string[]): Promise<number> {
  if (pageIds.length === 0) {
    return 0;
  }
  const sample = pageIds.slice(0, SAMPLE_PAGES);
  let bytes = 0;
  for (const id of sample) {
    const { data, error } = await client.storage.from("photos").list(`${userId}/${id}`);
    if (error || !Array.isArray(data)) {
      throw new ArchiveReadError();
    }
    for (const file of data) {
      const size = field(field(file, "metadata"), "size");
      if (typeof size === "number" && Number.isFinite(size) && size > 0) {
        bytes += size;
      }
    }
  }
  return Math.round((bytes / sample.length) * pageIds.length);
}

export async function planMyData(client: ArchiveClient, identity: ArchiveIdentity, control: ExportControl): Promise<PlanResult> {
  try {
    if (control.cancelled) {
      return { status: "cancelled" };
    }
    const pages = await ownRows(client, "pages", identity.userId);
    if (pages.length > MAX_ARCHIVE_PAGES) {
      return { status: "tooMany", max: MAX_ARCHIVE_PAGES };
    }
    if (!pages.every((row) => isIdentifier(row.id))) {
      return { status: "error" };
    }
    const estimate = await estimateBytes(
      client,
      identity.userId,
      pages.map((row) => row.id as string),
    );
    return control.cancelled ? { status: "cancelled" } : { status: "ready", plan: { identity, pages, estimate } };
  } catch (error) {
    if (control.cancelled) {
      return { status: "cancelled" };
    }
    return error instanceof ArchiveTooManyRowsError ? { status: "tooMany", max: MAX_ARCHIVE_PAGES } : { status: "error" };
  }
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 1);
}

function tick(control: ExportControl): void {
  if (control.cancelled) {
    throw new Cancelled();
  }
}

function usageOf(allowance: Allowance | null) {
  return allowance === null
    ? null
    : { used: allowance.used, max: allowance.max, remaining: allowance.remaining, resets_at: allowance.resetsAt };
}

function writeAccount(sink: ArchiveSink, deps: ArchiveDeps, identity: ArchiveIdentity, profile: Row | undefined, charges: Row[]): void {
  sink.addText("README.txt", deps.readme);
  sink.addText(
    "profile.json",
    json({
      id: identity.userId,
      email: identity.email,
      is_anonymous: identity.isAnonymous,
      interface_language: field(profile, "interface_language") ?? null,
      tier: field(profile, "tier") ?? null,
      birth_year: field(profile, "birth_year") ?? null,
      country: field(profile, "country") ?? null,
    }),
  );
  sink.addText("usage.json", json({ allowance: usageOf(deps.allowance), charges }));
}

const TEST_SHEETS = [1, 2] as const;
const TESTS_WITH_PHOTOS = ["pending", "accepted"];

async function writeTestPhotos(
  sink: ArchiveSink,
  deps: ArchiveDeps,
  control: ExportControl,
  identity: ArchiveIdentity,
  tests: Row[],
  counts: Counts,
): Promise<{ sheet: number; file: string | null }[][]> {
  if (!tests.every((row) => isIdentifier(row.id))) {
    throw new ArchiveReadError();
  }
  const listed: { sheet: number; file: string | null }[][] = [];
  for (const test of tests) {
    const photos: { sheet: number; file: string | null }[] = [];
    listed.push(photos);
    if (!TESTS_WITH_PHOTOS.includes(test.status as string)) {
      continue;
    }
    for (const sheet of TEST_SHEETS) {
      tick(control);
      counts.photos += 1;
      const source = await deps.photo(`${identity.userId}/writing-tests/${test.id as string}/${sheet}.jpg`);
      try {
        tick(control);
        if (source === null) {
          counts.missing += 1;
          photos.push({ sheet, file: null });
          continue;
        }
        sink.addBinary(`writing-tests/${test.id as string}/${sheet}.jpg`, source.chunks());
      } finally {
        source?.dispose();
      }
      photos.push({ sheet, file: `${sheet}.jpg` });
    }
  }
  return listed;
}

type PageData = Record<PageTable, Map<string, Row[]>>;

async function readGroup(client: ArchiveClient, userId: string, ids: string[]): Promise<PageData> {
  const tables: PageTable[] = ["page_images", "readings", "page_texts", "page_tokens", "corrections", "page_gaps", "page_alerts"];
  const found = await Promise.all(tables.map((table) => pageRows(client, table, userId, ids)));
  return Object.fromEntries(tables.map((table, index) => [table, found[index]])) as PageData;
}

type Counts = { photos: number; missing: number };

async function writePhotos(
  sink: ArchiveSink,
  deps: ArchiveDeps,
  control: ExportControl,
  identity: ArchiveIdentity,
  pageId: string,
  images: Row[],
  counts: Counts,
): Promise<{ kind: string; file: string | null }[]> {
  const listed: { kind: string; file: string | null }[] = [];
  for (const kind of PHOTO_KINDS) {
    const image = images.find((row) => row.kind === kind);
    if (image === undefined) {
      continue;
    }
    tick(control);
    counts.photos += 1;
    const source = image.storage_path === `${identity.userId}/${pageId}/${kind}.jpg` ? await deps.photo(image.storage_path) : null;
    try {
      tick(control);
      if (source === null) {
        counts.missing += 1;
        listed.push({ kind, file: null });
        continue;
      }
      sink.addBinary(`pages/${pageId}/${kind}.jpg`, source.chunks());
    } finally {
      source?.dispose();
    }
    const file = `${kind}.jpg`;
    listed.push({ kind, file });
  }
  return listed;
}

async function writePage(
  sink: ArchiveSink,
  deps: ArchiveDeps,
  control: ExportControl,
  identity: ArchiveIdentity,
  page: Row,
  data: PageData,
  counts: Counts,
): Promise<void> {
  const id = page.id as string;
  const images = await writePhotos(sink, deps, control, identity, id, data.page_images.get(id) ?? [], counts);
  const text = data.page_texts.get(id)?.[0];
  if (text !== undefined && typeof text.text === "string") {
    sink.addText(`pages/${id}/text.txt`, text.text);
  }
  sink.addText(
    `pages/${id}/page.json`,
    json({
      page,
      text: text === undefined ? null : { pipeline_version: text.pipeline_version },
      readings: (data.readings.get(id) ?? []).map(({ id: _readingId, page_id: _page, ...rest }) => rest),
      tokens: (data.page_tokens.get(id) ?? []).map(({ page_id: _page, ...rest }) => rest),
      corrections: (data.corrections.get(id) ?? []).map(({ id: _correctionId, page_id: _page, ...rest }) => rest),
      edited_text: (data.page_gaps.get(id) ?? []).map(({ page_id: _page, ...rest }) => rest),
      alerts: (data.page_alerts.get(id) ?? []).map(({ id: _alertId, page_id: _page, ...rest }) => rest),
      images,
    }),
  );
}

async function writeContents(
  sink: ArchiveSink,
  deps: ArchiveDeps,
  plan: MyDataPlan,
  control: ExportControl,
  progress: (done: number, total: number) => void,
): Promise<void> {
  const { identity, pages } = plan;
  const [profiles, charges, notebooks, chapters, lexicon, consents, tests, models] = await Promise.all([
    ownRows(deps.client, "profiles", identity.userId),
    ownRows(deps.client, "page_charges", identity.userId),
    ownRows(deps.client, "notebooks", identity.userId),
    ownRows(deps.client, "chapters", identity.userId),
    ownRows(deps.client, "lexicon_entries", identity.userId),
    ownRows(deps.client, "consents", identity.userId),
    ownRows(deps.client, "writing_tests", identity.userId),
    ownRows(deps.client, "htr_models", identity.userId),
  ]);
  tick(control);
  writeAccount(sink, deps, identity, profiles[0], charges);
  sink.addText("notebooks.json", json({ notebooks, chapters, lexicon }));
  const counts: Counts = { photos: 0, missing: 0 };
  const testPhotos = await writeTestPhotos(sink, deps, control, identity, tests, counts);
  sink.addText(
    "training.json",
    json({ consents, writing_tests: tests.map((test, index) => ({ ...test, photos: testPhotos[index] })), models }),
  );
  progress(0, pages.length);
  for (let from = 0; from < pages.length; from += PAGES_PER_GROUP) {
    tick(control);
    const group = pages.slice(from, from + PAGES_PER_GROUP);
    const data = await readGroup(
      deps.client,
      identity.userId,
      group.map((row) => row.id as string),
    );
    for (const page of group) {
      tick(control);
      await writePage(sink, deps, control, identity, page, data, counts);
      progress(from + group.indexOf(page) + 1, pages.length);
    }
  }
  sink.addText(
    "export.json",
    json({
      format_version: FORMAT_VERSION,
      exported_at: deps.now().toISOString(),
      notebooks: notebooks.length,
      chapters: chapters.length,
      pages: pages.length,
      photos: counts.photos,
      photos_missing: counts.missing,
    }),
  );
}

function failure(error: unknown, control: ExportControl): MyDataResult {
  if (control.cancelled || error instanceof Cancelled) {
    return { status: "cancelled" };
  }
  if (error instanceof ArchiveTooLargeError || error instanceof ArchiveTooManyRowsError) {
    return { status: "tooLarge" };
  }
  return { status: "error" };
}

export async function writeMyData(
  plan: MyDataPlan,
  deps: ArchiveDeps,
  control: ExportControl,
  progress: (done: number, total: number) => void,
): Promise<MyDataResult> {
  let saved: SavedArchive | null = null;
  let shared = false;
  try {
    if (deps.freeSpace() < plan.estimate * 1.2 + SPACE_MARGIN_BYTES) {
      return { status: "noSpace" };
    }
    saved = deps.open(deps.fileName);
    await writeContents(saved.sink, deps, plan, control, progress);
    tick(control);
    saved.sink.finish();
    tick(control);
    shared = await deps.share(saved.uri);
    return shared ? { status: "shared" } : { status: "unavailable" };
  } catch (error) {
    saved?.sink.abort();
    return failure(error, control);
  } finally {
    if (!shared) {
      saved?.discard();
    }
  }
}
