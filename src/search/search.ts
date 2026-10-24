import type { SupabaseClient } from "@supabase/supabase-js";

import { field } from "@/capture/api";
import type { WordReplacement } from "./text";

export type SearchClient = Pick<SupabaseClient, "from" | "rpc">;

export type SearchHit = {
  pageId: string;
  notebookId: string;
  rank: 1 | 2;
  tokenIndex: number | null;
  excerpt: string;
  matchStart: number | null;
  matchEnd: number | null;
  alsoRead: string | null;
};

export type SearchOutcome =
  | { status: "found"; hits: SearchHit[]; suggestions: WordReplacement[] }
  | { status: "tooLong" }
  | { status: "tooManyWords" }
  | { status: "error" };

export type AnchorKind = "word" | "line";

export type Anchor = { kind: AnchorKind; box: [number, number, number, number] };

const REFUSED = "22023";

function optionalNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function readHit(row: unknown): SearchHit | null {
  const pageId = field(row, "page_id");
  const notebookId = field(row, "notebook_id");
  const rank = field(row, "rank");
  const excerpt = field(row, "excerpt");
  const tokenIndex = optionalNumber(field(row, "token_index"));
  const matchStart = optionalNumber(field(row, "match_start"));
  const matchEnd = optionalNumber(field(row, "match_end"));
  const alsoRead = field(row, "also_read") ?? null;
  if (
    typeof pageId !== "string" ||
    typeof notebookId !== "string" ||
    (rank !== 1 && rank !== 2) ||
    typeof excerpt !== "string" ||
    tokenIndex === undefined ||
    matchStart === undefined ||
    matchEnd === undefined ||
    (matchStart === null) !== (matchEnd === null) ||
    (alsoRead !== null && typeof alsoRead !== "string")
  ) {
    return null;
  }
  return { pageId, notebookId, rank, tokenIndex, excerpt, matchStart, matchEnd, alsoRead };
}

function readSuggestions(data: unknown): WordReplacement[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const found: WordReplacement[] = [];
  for (const row of data) {
    const word = field(row, "word");
    const suggestion = field(row, "suggestion");
    if (typeof word === "string" && word !== "" && typeof suggestion === "string" && suggestion !== "") {
      found.push({ word, suggestion });
    }
  }
  return found;
}

export async function searchPages(client: SearchClient, rawQuery: string, notebookId: string | null): Promise<SearchOutcome> {
  const query = rawQuery.trim();
  if (query === "") {
    return { status: "found", hits: [], suggestions: [] };
  }
  const args = { p_query: query, p_notebook_id: notebookId };
  const [search, suggest] = await Promise.all([client.rpc("search_pages", args), client.rpc("suggest_words", args)]).catch(() => [null, null] as const);
  if (search === null) {
    return { status: "error" };
  }
  if (search.error) {
    if (field(search.error, "code") === REFUSED) {
      const message = field(search.error, "message");
      if (message === "query_too_long") {
        return { status: "tooLong" };
      }
      if (message === "query_too_many_words") {
        return { status: "tooManyWords" };
      }
    }
    return { status: "error" };
  }
  if (!Array.isArray(search.data)) {
    return { status: "error" };
  }
  const hits: SearchHit[] = [];
  for (const row of search.data) {
    const hit = readHit(row);
    if (hit === null) {
      return { status: "error" };
    }
    hits.push(hit);
  }
  return { status: "found", hits, suggestions: suggest !== null && !suggest.error ? readSuggestions(suggest.data) : [] };
}

function readBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return null;
  }
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number];
}

export async function readAnchor(client: Pick<SupabaseClient, "from">, pageId: string, tokenIndex: number): Promise<Anchor | null> {
  const { data, error } = await client
    .from("page_tokens")
    .select("anchor_kind, anchor")
    .eq("page_id", pageId)
    .eq("token_index", tokenIndex)
    .maybeSingle();
  if (error) {
    throw new Error("The box of the word could not be loaded.");
  }
  const kind = field(data, "anchor_kind");
  const box = readBox(field(data, "anchor"));
  return (kind === "word" || kind === "line") && box !== null ? { kind, box } : null;
}
