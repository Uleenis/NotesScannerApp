import type { SupabaseClient } from "@supabase/supabase-js";

export type ArchiveClient = Pick<SupabaseClient, "from" | "storage">;

export type Row = Record<string, unknown>;

export const ROWS_PER_REQUEST = 1000;
export const MAX_ROWS_PER_TABLE = 200_000;

export class ArchiveReadError extends Error {
  constructor() {
    super("The data of the account could not be read.");
  }
}

export class ArchiveTooManyRowsError extends Error {
  constructor() {
    super("The account holds too many rows to export.");
  }
}

const OWN_TABLES = {
  notebooks: { columns: "id, name, position, correction_level", order: ["id"], owner: "user_id" },
  chapters: { columns: "id, notebook_id, name, position", order: ["id"], owner: "user_id" },
  lexicon_entries: { columns: "notebook_id, form_key, form, occurrences, confirmed", order: ["notebook_id", "form_key"], owner: "user_id" },
  page_charges: { columns: "id, page_id, charged_at", order: ["id"], owner: "user_id" },
  profiles: { columns: "id, interface_language, tier, birth_year, country", order: ["id"], owner: "id" },
  consents: {
    columns: "id, kind, version, granted_by, parent_email, granted_at, revoked_at",
    order: ["granted_at", "id"],
    owner: "user_id",
  },
  writing_tests: {
    columns: "id, template, status, training_lines, validation_lines, redo, created_at, checked_at",
    order: ["created_at", "id"],
    owner: "user_id",
  },
  htr_models: {
    columns: "id, name, version, status, cer, alphabet_size, sample_count, faults_correct, created_at",
    order: ["version", "id"],
    owner: "user_id",
  },
  pages: {
    columns:
      "id, notebook_id, chapter_id, position, source, status, queue_reason, retry_count, captured_at, uploaded_at, read_at, page_type, language",
    order: ["id"],
    owner: "user_id",
  },
} as const;

const PAGE_TABLES = {
  page_images: { columns: "id, page_id, kind, storage_path", order: ["id"] },
  readings: {
    columns: "id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms",
    order: ["id"],
  },
  page_texts: { columns: "page_id, text, pipeline_version", order: ["page_id"] },
  page_tokens: {
    columns:
      "page_id, token_index, line_index, text, rule, channel, reading_a, reading_b1, reading_b2, review_status, anchor_kind, anchor, b1_start, b1_end",
    order: ["page_id", "token_index"],
  },
  corrections: {
    columns: "id, page_id, token_index, revision, previous_text, corrected_text, chosen_from, from_queue, created_at",
    order: ["id"],
  },
  page_gaps: { columns: "page_id, gap_index, text", order: ["page_id", "gap_index"] },
  page_alerts: { columns: "id, page_id, kind, details, created_at", order: ["id"] },
} as const;

export type OwnTable = keyof typeof OWN_TABLES;

export type PageTable = keyof typeof PAGE_TABLES;

export const EXPORTED_COLUMNS: Record<OwnTable | PageTable, string> = {
  ...Object.fromEntries(Object.entries(OWN_TABLES).map(([name, spec]) => [name, spec.columns])),
  ...Object.fromEntries(Object.entries(PAGE_TABLES).map(([name, spec]) => [name, spec.columns])),
} as Record<OwnTable | PageTable, string>;

type Scope = { column: string; value: string } | { column: string; values: string[] };

async function selectAll(client: ArchiveClient, table: string, columns: string, order: readonly string[], scopes: Scope[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += ROWS_PER_REQUEST) {
    let query = client.from(table).select(columns);
    for (const scope of scopes) {
      query = "values" in scope ? query.in(scope.column, scope.values) : query.eq(scope.column, scope.value);
    }
    for (const column of order) {
      query = query.order(column);
    }
    const { data, error } = await query.range(from, from + ROWS_PER_REQUEST - 1);
    if (error || !Array.isArray(data)) {
      throw new ArchiveReadError();
    }
    for (const row of data) {
      if (typeof row !== "object" || row === null) {
        throw new ArchiveReadError();
      }
      rows.push(row as Row);
    }
    if (rows.length > MAX_ROWS_PER_TABLE) {
      throw new ArchiveTooManyRowsError();
    }
    if (data.length < ROWS_PER_REQUEST) {
      return rows;
    }
  }
}

export function ownRows(client: ArchiveClient, table: OwnTable, userId: string): Promise<Row[]> {
  const spec = OWN_TABLES[table];
  return selectAll(client, table, spec.columns, spec.order, [{ column: spec.owner, value: userId }]);
}

export async function pageRows(client: ArchiveClient, table: PageTable, userId: string, pageIds: string[]): Promise<Map<string, Row[]>> {
  const spec = PAGE_TABLES[table];
  const rows = await selectAll(client, table, spec.columns, spec.order, [
    { column: "user_id", value: userId },
    { column: "page_id", values: pageIds },
  ]);
  const wanted = new Set(pageIds);
  const byPage = new Map<string, Row[]>();
  for (const row of rows) {
    const pageId = row.page_id;
    if (typeof pageId !== "string" || !wanted.has(pageId)) {
      continue;
    }
    const known = byPage.get(pageId);
    if (known === undefined) {
      byPage.set(pageId, [row]);
    } else {
      known.push(row);
    }
  }
  return byPage;
}
