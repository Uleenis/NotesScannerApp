import type { GeminiReading } from "./gemini.ts";
import type { Logger } from "./log.ts";
import type { PageType } from "./page-type.ts";
import type { ReadingService } from "./reading-service.ts";

export type PageStatus = "queued" | "processing" | "read" | "failed";

export type BlockReason = "monthly_limit" | "anonymous_limit" | "anonymous_daily_cap";

export type ChargeReason = "charged" | "already_charged" | "page_not_found" | BlockReason;

export type QueueReason = "read_error" | "offline";

export type PageRow = {
  id: string;
  userId: string;
  status: PageStatus;
  queueReason: QueueReason | null;
  retryCount: number;
  manualRelaunchedAt: string | null;
};

export type ClaimExpectation =
  | { status: "queued"; queueReason: QueueReason | null; retryCount: number }
  | { status: "failed"; retryCount: number; relaunchedBefore: string };

export type Allowance = {
  isAnonymous: boolean;
  used: number;
  max: number;
  remaining: number;
  resetsAt: string | null;
  blockedReason: BlockReason | null;
};

export type ChargeResult = { allowed: boolean; reason: ChargeReason };

export type PhotoInfo = { size: number; mimeType: string | null };

export type ReadingInput = {
  label: "B1";
  rawText: string;
  model: string;
  modelVersion: string;
  promptVersion: string;
  thinkingBudget: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export type Caller = { userId: string; isAnonymous: boolean };

export type Auth = {
  verify: (token: string) => Promise<Caller | null>;
};

export type PageReader = {
  getPage: (pageId: string) => Promise<PageRow | null>;
  photoInfo: (path: string) => Promise<PhotoInfo | null>;
  downloadPhoto: (path: string) => Promise<Uint8Array | null>;
};

export type CallerStore = PageReader & {
  allowance: () => Promise<Allowance | null>;
};

export type ServerStore = {
  charge: (pageId: string) => Promise<ChargeResult>;
  recordOriginalImage: (userId: string, pageId: string, path: string) => Promise<void>;
  claimForReading: (userId: string, pageId: string, expected: ClaimExpectation) => Promise<boolean>;
  insertReading: (userId: string, pageId: string, reading: ReadingInput) => Promise<void>;
  upsertPageText: (userId: string, pageId: string, text: string, pipelineVersion: string) => Promise<void>;
  markRead: (userId: string, pageId: string, readAt: string, pageType: PageType) => Promise<void>;
  releaseToQueue: (userId: string, pageId: string, reason: "read_error", retryCount: number) => Promise<void>;
  markFailed: (userId: string, pageId: string, retryCount: number) => Promise<void>;
  abandonQueued: (userId: string, pageId: string) => Promise<void>;
  createUploadUrl: (path: string) => Promise<{ signedUrl: string; token: string }>;
};

export type Bucket = "photos" | "alto" | "models";

export const ACCOUNT_BUCKETS: readonly Bucket[] = ["photos", "alto", "models"];

export type AccountStore = {
  removeFiles: (bucket: Bucket, userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
};

export type MoveResult = { ok: true; pages: number; notebooksMerged: number } | { ok: false; reason: "page_processing" };

export type TransferStore = {
  hasProcessingPage: (userId: string) => Promise<boolean>;
  listFiles: (bucket: Bucket, userId: string) => Promise<string[]>;
  copyFile: (bucket: Bucket, from: string, to: string) => Promise<void>;
  moveRows: (fromId: string, toId: string) => Promise<MoveResult>;
};

export type TransferAccountDeps = {
  auth: Auth;
  transfers: TransferStore;
  accounts: AccountStore;
  log: Logger;
};

export type DeleteAccountDeps = {
  auth: Auth;
  accounts: AccountStore;
  log: Logger;
};

export type PreparePageDeps = {
  auth: Auth;
  forCaller: (token: string) => CallerStore;
  server: Pick<ServerStore, "createUploadUrl">;
  log: Logger;
};

export type ReadingDeps = {
  server: ServerStore;
  gemini: (image: Uint8Array) => Promise<GeminiReading>;
  service: ReadingService | null;
  background: (task: Promise<void>) => void;
  clock: { now: () => number };
  log: Logger;
};

export type SwitchOutcome = "switched" | "unchanged" | "page_not_found" | "page_not_read" | "unsupported_script" | "no_reading";

export type PageTypeStore = {
  setMath: (userId: string, pageId: string) => Promise<{ outcome: SwitchOutcome; altoPath: string | null }>;
  setText: (userId: string, pageId: string, readAgain: boolean) => Promise<{ outcome: SwitchOutcome; b1: string | null }>;
  removeAlto: (path: string) => Promise<void>;
};

export type SetPageTypeDeps = {
  auth: Auth;
  forCaller: (token: string) => CallerStore;
  pageTypes: PageTypeStore;
  service: ReadingService | null;
  background: (task: Promise<void>) => void;
  clock: { now: () => number };
  log: Logger;
};

export type LibraryOutcome =
  | "deleted"
  | "moved"
  | "unchanged"
  | "page_not_found"
  | "chapter_not_found"
  | "notebook_not_found"
  | "page_processing";

export type NotebookPage = { id: string; status: PageStatus };

export type LibraryStore = {
  pageStatus: (userId: string, pageId: string) => Promise<PageStatus | null>;
  notebookPages: (userId: string, notebookId: string) => Promise<NotebookPage[] | null>;
  removePageFiles: (bucket: "photos" | "alto", userId: string, pageId: string) => Promise<void>;
  deletePage: (userId: string, pageId: string) => Promise<LibraryOutcome>;
  deleteChapter: (userId: string, chapterId: string) => Promise<LibraryOutcome>;
  deleteNotebook: (userId: string, notebookId: string) => Promise<{ outcome: LibraryOutcome; pageIds: string[] }>;
  movePage: (userId: string, pageId: string, notebookId: string, chapterId: string | null) => Promise<LibraryOutcome>;
};

export type LibraryDeps = {
  auth: Auth;
  library: LibraryStore;
  log: Logger;
};

export type ReadPageDeps = ReadingDeps & {
  auth: Auth;
  forCaller: (token: string) => CallerStore;
};

export type RelaunchPageDeps = ReadingDeps & {
  secret: string;
  reader: PageReader;
};
