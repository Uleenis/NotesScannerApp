export type LogEvent =
  | "refused"
  | "upload_prepared"
  | "charged"
  | "gemini_attempt_failed"
  | "read_done"
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
  | "reading_service_misconfigured"
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
  errorName?: string;
};

export type Logger = {
  event: (event: LogEvent, fields?: LogFields) => void;
};

const MAX_WORD_LENGTH = 64;
const PLAIN_WORD = /^[A-Za-z0-9_.:-]+$/;

const WORD_FIELDS = ["pageId", "code", "kind", "errorName"] as const;
const NUMBER_FIELDS = ["status", "attempt", "durationMs", "inputTokens", "outputTokens", "thoughtsTokens", "tokens"] as const;

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
