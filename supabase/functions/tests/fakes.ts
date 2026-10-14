import { GeminiFailure } from "../_shared/gemini.ts";
import type { GeminiFailureKind, GeminiReading } from "../_shared/gemini.ts";
import { photoPath } from "../_shared/photo.ts";
import type {
  AccountStore,
  Allowance,
  Auth,
  Bucket,
  Caller,
  CallerStore,
  DeleteAccountDeps,
  ChargeReason,
  ChargeResult,
  MoveResult,
  PageRow,
  PageReader,
  PageStatus,
  PhotoInfo,
  PreparePageDeps,
  QueueReason,
  ReadingInput,
  ReadPageDeps,
  RelaunchPageDeps,
  ServerStore,
  TransferAccountDeps,
  TransferStore,
} from "../_shared/ports.ts";
import type { LogEvent, LogFields, Logger } from "../_shared/log.ts";

export const ALICE = "11111111-1111-4111-8111-111111111111";
export const BOB = "22222222-2222-4222-8222-222222222222";
export const CAROL = "33333333-3333-4333-8333-333333333333";
export const PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER_PAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const TOKEN_ALICE = "token-alice";
export const TOKEN_BOB = "token-bob";
export const TOKEN_CAROL = "token-carol";

export const CANARY_NOTEBOOK_NAME = "PANDA-CANARY-NOTEBOOK-NAME";
export const CANARY_EMAIL = "lynx-canary@example.test";

export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

export const MAX_BYTES = 10 * 1024 * 1024;

export const RELAUNCH_SECRET = "relaunch-".repeat(6);
export const DAY_MS = 24 * 60 * 60 * 1000;
export const START_OF_TEST = Date.UTC(2026, 9, 6, 10, 0, 0);

export const CANARY_PAGE_TEXT = "ZEBRA-CANARY-PAGE-TEXT";
export const CANARY_GEMINI_ERROR = "GIRAFFE-CANARY-GEMINI-ERROR";
export const CANARY_EXCEPTION = "OTTER-CANARY-EXCEPTION";
export const CANARY_UPLOAD_TOKEN = "HERON-CANARY-UPLOAD-TOKEN";

export const DEFAULT_READING: GeminiReading = {
  text: "First line\nSecond line",
  modelVersion: "gemini-3.6-flash-001",
  inputTokens: 1100,
  outputTokens: 216,
  thoughtsTokens: 0,
};

export const OPEN_ALLOWANCE: Allowance = {
  isAnonymous: false,
  used: 2,
  max: 15,
  remaining: 13,
  resetsAt: "2026-11-01T00:00:00+01:00",
  blockedReason: null,
};

type FakePage = {
  id: string;
  userId: string;
  status: PageStatus;
  queueReason: QueueReason | null;
  retryCount: number;
  readAt: string | null;
  manualRelaunchedAt: string | null;
  notebookId: string | null;
  chapterId: string | null;
};

type FakeNotebook = { id: string; userId: string; name: string };

type FakeChapter = { id: string; userId: string; notebookId: string; name: string };

type FakePhoto = { bytes: Uint8Array; mimeType: string | null; size: number };

type StoredReading = ReadingInput & { userId: string; pageId: string };

export type LogRecord = { event: LogEvent; fields: LogFields };

export class World {
  pages = new Map<string, FakePage>();
  notebooks = new Map<string, FakeNotebook>();
  chapters = new Map<string, FakeChapter>();
  anonymousUsers = new Set<string>();
  copies: { bucket: Bucket; from: string; to: string }[] = [];
  failCopyAt: number | null = null;
  loseCopies = new Set<Bucket>();
  onCopy: (() => void) | null = null;
  photos = new Map<string, FakePhoto>();
  alto = new Map<string, Uint8Array>();
  models = new Map<string, Uint8Array>();
  altoReadings: { userId: string; pageId: string; path: string }[] = [];
  pageTokens: { userId: string; pageId: string; index: number }[] = [];
  charges: { userId: string; pageId: string }[] = [];
  chargeArguments: unknown[][] = [];
  claimArguments: unknown[][] = [];
  readings: StoredReading[] = [];
  pageTexts = new Map<string, { userId: string; text: string; pipelineVersion: string }>();
  pageImages: { userId: string; pageId: string; path: string; kind: string }[] = [];
  uploadPaths: string[] = [];
  allowances = new Map<string, Allowance>();
  forcedCharge: ChargeReason | null = null;
  geminiOutcomes: (GeminiReading | Error)[] = [];
  geminiImages: Uint8Array[] = [];
  failOn = new Set<string>();
  calls: string[] = [];
  deletedPhotos = 0;
  deletedUsers: string[] = [];
  abandoned: string[] = [];
  clock = START_OF_TEST;
  geminiDurationMs = 250;
  logs: LogRecord[] = [];
  brokenRowLevelSecurity = false;
  loggerOverride: Logger | null = null;

  addPage(userId: string, status: PageStatus = "queued", id: string = PAGE_ID): void {
    this.pages.set(id, { id, userId, status, queueReason: null, retryCount: 0, readAt: null, manualRelaunchedAt: null, notebookId: null, chapterId: null });
  }

  addNotebook(userId: string, name: string, id: string = crypto.randomUUID()): string {
    this.notebooks.set(id, { id, userId, name });
    return id;
  }

  addChapter(userId: string, notebookId: string, name: string, id: string = crypto.randomUUID()): string {
    this.chapters.set(id, { id, userId, notebookId, name });
    return id;
  }

  place(pageId: string, notebookId: string, chapterId: string | null = null): void {
    const page = this.page(pageId);
    page.notebookId = notebookId;
    page.chapterId = chapterId;
  }

  addPhoto(userId: string, pageId: string, bytes: Uint8Array = JPEG_BYTES, mimeType: string | null = "image/jpeg", size?: number): void {
    this.photos.set(photoPath(userId, pageId), { bytes, mimeType, size: size ?? bytes.length });
  }

  readyPage(userId: string = ALICE, id: string = PAGE_ID): void {
    this.addPage(userId, "queued", id);
    this.addPhoto(userId, id);
  }

  addReadingA(userId: string, pageId: string, words: number = 2): string {
    const path = `${userId}/${pageId}/a.xml`;
    this.alto.set(path, new TextEncoder().encode("<alto/>"));
    this.altoReadings.push({ userId, pageId, path });
    for (let index = 0; index < words; index++) this.pageTokens.push({ userId, pageId, index });
    return path;
  }

  files(bucket: Bucket): Map<string, unknown> {
    return bucket === "photos" ? this.photos : bucket === "alto" ? this.alto : this.models;
  }

  filesOf(bucket: Bucket, userId: string): string[] {
    return [...this.files(bucket).keys()].filter((path) => path.startsWith(`${userId}/`)).sort();
  }

  page(id: string = PAGE_ID): FakePage {
    const page = this.pages.get(id);
    if (!page) throw new Error("no such page in the fake");
    return page;
  }

  push(...outcomes: (GeminiReading | Error)[]): void {
    this.geminiOutcomes.push(...outcomes);
  }

  failGemini(kind: GeminiFailureKind = "http_error"): GeminiFailure {
    return new GeminiFailure(kind);
  }

  userFor(token: string): string | null {
    const userId = token === TOKEN_ALICE ? ALICE : token === TOKEN_BOB ? BOB : token === TOKEN_CAROL ? CAROL : null;
    return userId !== null && !this.deletedUsers.includes(userId) ? userId : null;
  }

  authPort(): Auth {
    return {
      verify: (token): Promise<Caller | null> => {
        const userId = this.userFor(token);
        return Promise.resolve(userId === null ? null : { userId, isAnonymous: this.anonymousUsers.has(userId) });
      },
    };
  }

  private fail(name: string): void {
    if (this.failOn.has(name)) throw new Error(`${CANARY_EXCEPTION} ${name}`);
  }

  private async tick(name: string): Promise<void> {
    this.calls.push(name);
    await Promise.resolve();
    this.fail(name);
  }

  private allowanceFor(userId: string): Allowance {
    return this.allowances.get(userId) ?? OPEN_ALLOWANCE;
  }

  logger(): Logger {
    return this.loggerOverride ?? {
      event: (event, fields = {}) => {
        this.logs.push({ event, fields });
      },
    };
  }

  caller(token: string): CallerStore {
    const userId = this.userFor(token);
    const visible = (ownerId: string) => this.brokenRowLevelSecurity || ownerId === userId;
    return {
      getPage: async (pageId): Promise<PageRow | null> => {
        await this.tick("getPage");
        const page = this.pages.get(pageId);
        if (!page || !visible(page.userId)) return null;
        return {
          id: page.id,
          userId: page.userId,
          status: page.status,
          queueReason: page.queueReason,
          retryCount: page.retryCount,
          manualRelaunchedAt: page.manualRelaunchedAt,
        };
      },
      allowance: async (): Promise<Allowance | null> => {
        await this.tick("allowance");
        return userId ? this.allowanceFor(userId) : null;
      },
      photoInfo: async (path): Promise<PhotoInfo | null> => {
        await this.tick("photoInfo");
        const photo = this.photos.get(path);
        if (!photo || !path.startsWith(`${userId}/`)) return null;
        return { size: photo.size, mimeType: photo.mimeType };
      },
      downloadPhoto: async (path): Promise<Uint8Array | null> => {
        await this.tick("download");
        const photo = this.photos.get(path);
        if (!photo || !path.startsWith(`${userId}/`)) return null;
        return photo.bytes;
      },
    };
  }

  server(): ServerStore {
    return {
      charge: async (...args: unknown[]): Promise<ChargeResult> => {
        this.chargeArguments.push(args);
        await this.tick("charge");
        const pageId = args[0] as string;
        const page = this.pages.get(pageId);
        if (this.forcedCharge) return { allowed: this.forcedCharge === "charged" || this.forcedCharge === "already_charged", reason: this.forcedCharge };
        if (!page) return { allowed: false, reason: "page_not_found" };
        if (this.charges.some((c) => c.pageId === pageId)) return { allowed: true, reason: "already_charged" };
        const allowance = this.allowanceFor(page.userId);
        if (allowance.blockedReason) return { allowed: false, reason: allowance.blockedReason };
        this.charges.push({ userId: page.userId, pageId });
        return { allowed: true, reason: "charged" };
      },
      recordOriginalImage: async (userId, pageId, path) => {
        await this.tick("recordOriginalImage");
        if (!this.pageImages.some((i) => i.path === path)) {
          this.pageImages.push({ userId, pageId, path, kind: "original" });
        }
      },
      claimForReading: async (userId, pageId, expected) => {
        this.claimArguments.push([userId, pageId, expected]);
        await this.tick("claim");
        const page = this.pages.get(pageId);
        if (!page || page.userId !== userId || page.status !== expected.status || page.retryCount !== expected.retryCount) return false;
        if (expected.status === "queued") {
          if (page.queueReason !== expected.queueReason) return false;
        } else if (page.manualRelaunchedAt !== null && page.manualRelaunchedAt > expected.relaunchedBefore) {
          return false;
        }
        if (page.status === "failed") page.manualRelaunchedAt = new Date(this.clock).toISOString();
        page.queueReason = null;
        page.status = "processing";
        return true;
      },
      insertReading: async (userId, pageId, reading) => {
        await this.tick("insertReading");
        const page = this.pages.get(pageId);
        if (!page || page.userId !== userId) throw new Error("write for another owner");
        this.readings.push({ ...reading, userId, pageId });
      },
      upsertPageText: async (userId, pageId, text, pipelineVersion) => {
        await this.tick("upsertPageText");
        const page = this.pages.get(pageId);
        if (!page || page.userId !== userId) throw new Error("write for another owner");
        this.pageTexts.set(pageId, { userId, text, pipelineVersion });
      },
      markRead: async (userId, pageId, readAt) => {
        await this.tick("markRead");
        const page = this.pages.get(pageId);
        if (!page || page.userId !== userId || page.status !== "processing") throw new Error("write for another owner or state");
        page.status = "read";
        page.readAt = readAt;
        page.queueReason = null;
      },
      releaseToQueue: async (userId, pageId, reason, retryCount) => {
        await this.tick("releaseToQueue");
        const page = this.pages.get(pageId);
        if (!page || page.userId !== userId || page.status !== "processing") throw new Error("write for another owner or state");
        page.status = "queued";
        page.queueReason = reason;
        page.retryCount = retryCount;
      },
      markFailed: async (userId, pageId, retryCount) => {
        await this.tick("markFailed");
        const page = this.pages.get(pageId);
        if (!page || page.userId !== userId || page.status !== "processing") throw new Error("write for another owner or state");
        page.status = "failed";
        page.queueReason = null;
        page.retryCount = retryCount;
      },
      abandonQueued: async (userId, pageId) => {
        await this.tick("abandonQueued");
        const page = this.pages.get(pageId);
        if (!page || page.userId !== userId || page.status !== "queued" || page.queueReason !== "read_error") throw new Error("write for another owner or state");
        page.status = "failed";
        page.queueReason = null;
        this.abandoned.push(pageId);
      },
      createUploadUrl: async (path) => {
        await this.tick("createUploadUrl");
        this.uploadPaths.push(path);
        return { signedUrl: `http://storage.test/upload/${path}?token=${CANARY_UPLOAD_TOKEN}`, token: CANARY_UPLOAD_TOKEN };
      },
    };
  }

  reader(): PageReader {
    return {
      getPage: async (pageId): Promise<PageRow | null> => {
        await this.tick("getPage");
        const page = this.pages.get(pageId);
        if (!page) return null;
        return {
          id: page.id,
          userId: page.userId,
          status: page.status,
          queueReason: page.queueReason,
          retryCount: page.retryCount,
          manualRelaunchedAt: page.manualRelaunchedAt,
        };
      },
      photoInfo: async (path): Promise<PhotoInfo | null> => {
        await this.tick("photoInfo");
        const photo = this.photos.get(path);
        return photo ? { size: photo.size, mimeType: photo.mimeType } : null;
      },
      downloadPhoto: async (path): Promise<Uint8Array | null> => {
        await this.tick("download");
        return this.photos.get(path)?.bytes ?? null;
      },
    };
  }

  accounts(): AccountStore {
    return {
      removeFiles: async (bucket, userId) => {
        await this.tick(`removeFiles:${bucket}`);
        for (const path of this.filesOf(bucket, userId)) this.files(bucket).delete(path);
      },
      deleteUser: async (userId) => {
        await this.tick("deleteUser");
        this.deletedUsers.push(userId);
        for (const [id, page] of [...this.pages]) {
          if (page.userId === userId) {
            this.pages.delete(id);
            this.pageTexts.delete(id);
          }
        }
        for (const [id, notebook] of [...this.notebooks]) if (notebook.userId === userId) this.notebooks.delete(id);
        for (const [id, chapter] of [...this.chapters]) if (chapter.userId === userId) this.chapters.delete(id);
        this.readings = this.readings.filter((reading) => reading.userId !== userId);
        this.pageImages = this.pageImages.filter((image) => image.userId !== userId);
        this.charges = this.charges.filter((charge) => charge.userId !== userId);
        this.altoReadings = this.altoReadings.filter((reading) => reading.userId !== userId);
        this.pageTokens = this.pageTokens.filter((token) => token.userId !== userId);
      },
    };
  }

  transfers(): TransferStore {
    return {
      hasProcessingPage: async (userId) => {
        await this.tick("hasProcessingPage");
        return [...this.pages.values()].some((page) => page.userId === userId && page.status === "processing");
      },
      listFiles: async (bucket, userId) => {
        await this.tick(`listFiles:${bucket}`);
        return this.filesOf(bucket, userId);
      },
      copyFile: async (bucket, from, to) => {
        await this.tick(`copyFile:${bucket}`);
        this.copies.push({ bucket, from, to });
        this.onCopy?.();
        if (this.failCopyAt === this.copies.length) throw new Error(`${CANARY_EXCEPTION} copy`);
        const files = this.files(bucket);
        const file = files.get(from);
        if (file === undefined) throw new Error("the file to copy is not there");
        if (this.loseCopies.has(bucket) || files.has(to)) return;
        files.set(to, file);
      },
      moveRows: async (fromId, toId): Promise<MoveResult> => {
        await this.tick("moveRows");
        const mine = [...this.pages.values()].filter((page) => page.userId === fromId);
        if (mine.some((page) => page.status === "processing")) return { ok: false, reason: "page_processing" };
        const same = (a: string, b: string) => a.trim() === b.trim();
        const merged = new Map<string, string>();
        for (const notebook of [...this.notebooks.values()].filter((n) => n.userId === fromId)) {
          const twin = [...this.notebooks.values()].find((n) => n.userId === toId && same(n.name, notebook.name));
          if (twin) merged.set(notebook.id, twin.id);
        }
        for (const chapter of [...this.chapters.values()].filter((c) => c.userId === fromId)) {
          chapter.notebookId = merged.get(chapter.notebookId) ?? chapter.notebookId;
          chapter.userId = toId;
        }
        for (const notebook of [...this.notebooks.values()].filter((n) => n.userId === fromId)) {
          if (merged.has(notebook.id)) this.notebooks.delete(notebook.id);
          else notebook.userId = toId;
        }
        for (const page of mine) {
          if (page.notebookId !== null) page.notebookId = merged.get(page.notebookId) ?? page.notebookId;
          page.userId = toId;
        }
        for (const image of this.pageImages) {
          if (image.userId !== fromId) continue;
          image.userId = toId;
          image.path = `${toId}${image.path.slice(fromId.length)}`;
        }
        for (const reading of this.readings) if (reading.userId === fromId) reading.userId = toId;
        for (const reading of this.altoReadings) {
          if (reading.userId !== fromId) continue;
          reading.userId = toId;
          reading.path = `${toId}${reading.path.slice(fromId.length)}`;
        }
        for (const token of this.pageTokens) if (token.userId === fromId) token.userId = toId;
        for (const text of this.pageTexts.values()) if (text.userId === fromId) text.userId = toId;
        for (const charge of this.charges) if (charge.userId === fromId) charge.userId = toId;
        return { ok: true, pages: mine.length, notebooksMerged: merged.size };
      },
    };
  }

  gemini() {
    return async (image: Uint8Array): Promise<GeminiReading> => {
      this.calls.push("gemini");
      this.geminiImages.push(image);
      await Promise.resolve();
      this.clock += this.geminiDurationMs;
      const outcome = this.geminiOutcomes.shift() ?? DEFAULT_READING;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    };
  }

  readDeps(): ReadPageDeps {
    return {
      auth: this.authPort(),
      forCaller: (token) => this.caller(token),
      server: this.server(),
      gemini: this.gemini(),
      clock: { now: () => this.clock },
      log: this.logger(),
    };
  }

  relaunchDeps(secret: string = RELAUNCH_SECRET): RelaunchPageDeps {
    return {
      secret,
      reader: this.reader(),
      server: this.server(),
      gemini: this.gemini(),
      clock: { now: () => this.clock },
      log: this.logger(),
    };
  }

  accountDeps(): DeleteAccountDeps {
    return {
      auth: this.authPort(),
      accounts: this.accounts(),
      log: this.logger(),
    };
  }

  transferDeps(): TransferAccountDeps {
    return {
      auth: this.authPort(),
      transfers: this.transfers(),
      accounts: this.accounts(),
      log: this.logger(),
    };
  }

  prepareDeps(): PreparePageDeps {
    const { auth, forCaller, server, log } = this.readDeps();
    return { auth, forCaller, server, log };
  }
}

export function post(token: string | null, body: unknown, method: string = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("http://functions.test/fn", {
    method,
    headers,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function transferRequest(anonymousToken: string | null, accountToken: string | null, body: unknown = {}, method: string = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (anonymousToken !== null) headers.authorization = `Bearer ${anonymousToken}`;
  if (accountToken !== null) headers["x-account-token"] = accountToken;
  return new Request("http://functions.test/fn", {
    method,
    headers,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function relaunch(secret: string | null, body: unknown, method: string = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-relaunch-secret"] = secret;
  return new Request("http://functions.test/fn", {
    method,
    headers,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

export function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = record;
  console.info = record;
  console.warn = record;
  console.error = record;
  console.debug = record;
  return {
    lines,
    restore: () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
    },
  };
}
