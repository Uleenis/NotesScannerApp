import type { GeminiReading } from "./gemini.ts";
import type { Logger } from "./log.ts";

export type PageStatus = "queued" | "processing" | "read" | "failed";

export type BlockReason = "monthly_limit" | "anonymous_limit" | "anonymous_daily_cap";

export type ChargeReason = "charged" | "already_charged" | "page_not_found" | BlockReason;

export type PageRow = { id: string; userId: string; status: PageStatus };

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

export type Caller = { userId: string };

export type Auth = {
  verify: (token: string) => Promise<Caller | null>;
};

export type CallerStore = {
  getPage: (pageId: string) => Promise<PageRow | null>;
  allowance: () => Promise<Allowance | null>;
  photoInfo: (path: string) => Promise<PhotoInfo | null>;
  downloadPhoto: (path: string) => Promise<Uint8Array | null>;
};

export type ServerStore = {
  charge: (pageId: string) => Promise<ChargeResult>;
  recordOriginalImage: (userId: string, pageId: string, path: string) => Promise<void>;
  claimForReading: (userId: string, pageId: string) => Promise<boolean>;
  insertReading: (userId: string, pageId: string, reading: ReadingInput) => Promise<void>;
  upsertPageText: (userId: string, pageId: string, text: string, pipelineVersion: string) => Promise<void>;
  markRead: (userId: string, pageId: string, readAt: string) => Promise<void>;
  releaseToQueue: (userId: string, pageId: string, reason: "read_error") => Promise<void>;
  createUploadUrl: (path: string) => Promise<{ signedUrl: string; token: string }>;
};

export type PreparePageDeps = {
  auth: Auth;
  forCaller: (token: string) => CallerStore;
  server: Pick<ServerStore, "createUploadUrl">;
  log: Logger;
};

export type ReadPageDeps = {
  auth: Auth;
  forCaller: (token: string) => CallerStore;
  server: ServerStore;
  gemini: (image: Uint8Array) => Promise<GeminiReading>;
  clock: { now: () => number };
  log: Logger;
};
