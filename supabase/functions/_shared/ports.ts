import type { GeminiReading } from "./gemini.ts";
import type { GeminiRenderer } from "./gemini-render.ts";
import type { Logger } from "./log.ts";
import type { PageType } from "./page-type.ts";
import type { ReadingService } from "./reading-service.ts";
import type { WritingTemplate } from "./writing-test.ts";

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

export type ReadingPass = "B1" | "B2";

export type ReadingInput = {
  label: ReadingPass;
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

export type MathAlertOutcome = "recorded" | "page_not_found" | "not_math" | "no_readings";

export type MathCheckStore = {
  mathCheckReadings: (userId: string, pageId: string) => Promise<{ b1: string; b2: string } | null>;
  recordMathAlert: (userId: string, pageId: string, onlyB1: number, onlyB2: number) => Promise<MathAlertOutcome>;
};

export type ServerStore = MathCheckStore & {
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

export type RevokeStore = {
  removeFiles: (userId: string) => Promise<void>;
  revoke: (userId: string) => Promise<boolean>;
};

export type RevokeTrainingDeps = {
  auth: Auth;
  training: RevokeStore;
  log: Logger;
};

export type CorrectionLevel = "course" | "journal" | "grammar";

export type LevelOutcome = "set" | "notebook_not_found" | "requires_model";

export type LevelStore = {
  set: (userId: string, notebookId: string, level: CorrectionLevel) => Promise<LevelOutcome>;
};

export type SetCorrectionLevelDeps = {
  auth: Auth;
  levels: LevelStore;
  log: Logger;
};

export type WritingBegin = {
  outcome: "started" | "consent_required" | "test_in_progress" | "test_limit";
  testId: string | null;
  expired: string[];
};

export type SheetCounts = { sheet1Training: number; sheet2Training: number; sheet2Validation: number };

export type WritingFinish = {
  outcome: "accepted" | "rejected" | "test_not_found" | "consent_required";
  redo: number[];
  replaced: string[];
};

export type WritingTestStore = {
  begin: (userId: string, template: WritingTemplate) => Promise<WritingBegin>;
  pending: (userId: string, testId: string) => Promise<{ template: WritingTemplate } | null>;
  finish: (userId: string, testId: string, counts: SheetCounts) => Promise<WritingFinish>;
  fail: (userId: string, testId: string) => Promise<boolean>;
  createUploadUrl: (path: string) => Promise<{ signedUrl: string; token: string }>;
  downloadPhoto: (path: string) => Promise<Uint8Array | null>;
  removeTestFiles: (userId: string, testId: string) => Promise<void>;
};

export type PrepareWritingTestDeps = {
  auth: Auth;
  tests: WritingTestStore;
  log: Logger;
};

export type CheckWritingTestDeps = {
  auth: Auth;
  tests: WritingTestStore;
  service: ReadingService | null;
  running: Set<string>;
  background: (task: Promise<void>) => void;
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
  gemini: (image: Uint8Array, pass?: ReadingPass) => Promise<GeminiReading>;
  service: ReadingService | null;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  background: (task: Promise<void>) => void;
  clock: { now: () => number };
  log: Logger;
};

export type SwitchOutcome = "switched" | "unchanged" | "page_not_found" | "page_not_read" | "unsupported_script" | "no_reading";

export type PageTypeStore = MathCheckStore & {
  setMath: (userId: string, pageId: string) => Promise<{ outcome: SwitchOutcome; altoPath: string | null }>;
  setText: (userId: string, pageId: string, readAgain: boolean) => Promise<{ outcome: SwitchOutcome; b1: string | null; b2: string | null }>;
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

export type SweepStore = {
  orphans: (limit: number) => Promise<string[]>;
  remove: (paths: readonly string[]) => Promise<number>;
};

export type SweepKind = "alto" | "models" | "writingTests";

export type SweepAltoDeps = {
  secret: string;
  sweeps: Record<SweepKind, SweepStore>;
  clock: { now: () => number };
  log: Logger;
};

export type RelaunchPageDeps = ReadingDeps & {
  secret: string;
  reader: PageReader;
};

export type EditOutcome = "edited" | "page_not_found" | "page_not_read" | "unsupported_script" | "not_editable" | "text_mismatch" | "invalid_edit";

export type EditedWord = { token_index: number; text: string };

export type EditedGap = { gap_index: number; text: string };

export type EditStore = {
  editPage: (userId: string, pageId: string, text: string, words: readonly EditedWord[], gaps: readonly EditedGap[]) => Promise<EditOutcome>;
};

export type EditDeps = {
  auth: Auth;
  edits: EditStore;
  log: Logger;
};

export type RenderablePage = {
  status: PageStatus;
  pageType: PageType;
  text: string | null;
  rendering: { text: string; basedOn: string } | null;
};

export type StoredRendering = { text: string; basedOn: string; model: string; promptVersion: string };

export type RenderStore = {
  page: (userId: string, pageId: string) => Promise<RenderablePage | null>;
  charge: (userId: string) => Promise<{ allowed: boolean; used: number }>;
  save: (userId: string, pageId: string, rendering: StoredRendering) => Promise<void>;
};

export type RenderDeps = {
  auth: Auth;
  renders: RenderStore;
  gemini: GeminiRenderer;
  clock: { now: () => number };
  log: Logger;
};

export type ParentRequestOutcome = "requested" | "account_not_registered" | "age_missing" | "not_under_age" | "consent_already_active" | "invalid_email" | "same_email" | "send_limit";

export type ParentConfirmOutcome =
  | "confirmed"
  | "no_request"
  | "invalid_code"
  | "code_expired"
  | "wrong_code"
  | "account_not_registered"
  | "consent_version_outdated"
  | "age_missing"
  | "not_under_age"
  | "consent_already_active";

export type ParentConsentStore = {
  request: (userId: string, parentEmail: string) => Promise<{ outcome: ParentRequestOutcome; requestId: string | null; code: string | null }>;
  withdraw: (userId: string, requestId: string) => Promise<void>;
  confirm: (userId: string, code: string) => Promise<{ outcome: ParentConfirmOutcome; attemptsLeft: number | null }>;
};

export type Mail = { to: string; subject: string; text: string };

export type Mailer = {
  send: (mail: Mail) => Promise<void>;
};

export type ParentConsentDeps = {
  auth: Auth;
  parents: ParentConsentStore;
  mailer: Mailer | null;
  log: Logger;
};

export type TrainingCorrection = { tokenIndex: number; text: string; readingA: string | null };

export type TrainingPage = { pageId: string; b1: string; language: string | null; corrections: TrainingCorrection[] };

export type ClaimedTask = {
  taskId: string;
  userId: string;
  testId: string;
  template: WritingTemplate;
  model: { path: string; sha256: string } | null;
  pages: TrainingPage[];
};

export type UploadOutcome = "ready" | "task_not_found" | "task_expired" | "consent_required";

export type TrainingMeasures = {
  cer: number;
  baseCer: number;
  faults: number;
  baseFaults: number;
  alphabet: number;
  samples: number;
  sha256: string;
};

export type TrainingReport = { outcome: "trained"; measures: TrainingMeasures } | { outcome: "failed" };

export type ReportOutcome = "activated" | "rejected" | "failed" | "model_missing" | "task_not_found" | "task_expired" | "consent_required";

export type TrainingBucket = "photos" | "models";

export type TrainingStore = {
  claim: () => Promise<ClaimedTask | null>;
  uploadTarget: (taskId: string) => Promise<{ outcome: UploadOutcome; path: string | null }>;
  report: (taskId: string, report: TrainingReport) => Promise<{ outcome: ReportOutcome; remove: string[] }>;
  signedReads: (bucket: TrainingBucket, paths: readonly string[], seconds: number) => Promise<(string | null)[]>;
  signedUpload: (path: string) => Promise<string>;
  removeModels: (paths: readonly string[]) => Promise<void>;
};

export type TrainingDeps = {
  secret: string;
  training: TrainingStore;
  log: Logger;
};
