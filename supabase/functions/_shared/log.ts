export type LogEvent =
  | "refused"
  | "upload_prepared"
  | "charged"
  | "gemini_attempt_failed"
  | "read_done"
  | "b2_done"
  | "b2_failed"
  | "b2_late"
  | "math_checked"
  | "read_queued"
  | "read_failed"
  | "manual_relaunch"
  | "page_abandoned"
  | "account_deleted"
  | "account_files_left"
  | "account_transferred"
  | "a_sent"
  | "recognize_attempt_failed"
  | "arbitrate_attempt_failed"
  | "a_cancelled"
  | "a_abandoned"
  | "a_done"
  | "page_type_set"
  | "alto_left"
  | "page_deleted"
  | "chapter_deleted"
  | "notebook_deleted"
  | "page_moved"
  | "page_edited"
  | "files_left"
  | "alto_swept"
  | "render_done"
  | "render_cached"
  | "render_discarded"
  | "render_failed"
  | "render_limit"
  | "reading_service_misconfigured"
  | "parent_consent_requested"
  | "parent_consent_confirmed"
  | "parent_email_failed"
  | "training_revoked"
  | "correction_level_set"
  | "training_files_left"
  | "writing_test_started"
  | "writing_test_checked"
  | "writing_test_failed"
  | "training_claimed"
  | "training_upload"
  | "training_reported"
  | "models_swept"
  | "writing_tests_swept"
  | "writing_test_files_left"
  | "unexpected_error";

export type LogFields = {
  pageId?: string;
  code?: string;
  status?: number;
  attempt?: number;
  kind?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  thoughtsTokens?: number;
  tokens?: number;
  files?: number;
  training?: number;
  validation?: number;
  errorName?: string;
};

export type Logger = {
  event: (event: LogEvent, fields?: LogFields) => void;
};

const MAX_WORD_LENGTH = 64;
const PLAIN_WORD = /^[A-Za-z0-9_.:-]+$/;

const WORD_FIELDS = ["pageId", "code", "kind", "errorName"] as const;
const NUMBER_FIELDS = ["status", "attempt", "durationMs", "inputTokens", "outputTokens", "thoughtsTokens", "tokens", "files", "training", "validation"] as const;

export function createLogger(sink: (line: string) => void): Logger {
  return {
    event: (event, fields = {}) => {
      const record: Record<string, string | number> = { event };
      for (const name of WORD_FIELDS) {
        const value = fields[name];
        if (typeof value === "string" && value.length <= MAX_WORD_LENGTH && PLAIN_WORD.test(value)) {
          record[name] = value;
        }
      }
      for (const name of NUMBER_FIELDS) {
        const value = fields[name];
        if (typeof value === "number" && Number.isFinite(value)) {
          record[name] = value;
        }
      }
      sink(JSON.stringify(record));
    },
  };
}

export const consoleLogger: Logger = createLogger((line) => console.log(line));

export function errorName(error: unknown): string {
  return error instanceof Error && PLAIN_WORD.test(error.constructor.name) ? error.constructor.name : "unknown";
}
