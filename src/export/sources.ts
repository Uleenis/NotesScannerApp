import type { SupabaseClient } from "@supabase/supabase-js";

import { field } from "@/capture/api";
import type { ExportSource } from "./document";

export type SourcesClient = Pick<SupabaseClient, "from">;

const GROUP = 50;
const PARALLEL = 6;

async function secondReadings(client: SourcesClient, ids: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let from = 0; from < ids.length; from += GROUP) {
    const { data, error } = await client
      .from("readings")
      .select("page_id, raw_text")
      .eq("label", "B2")
      .in("page_id", ids.slice(from, from + GROUP));
    if (error || !Array.isArray(data)) {
      throw new Error("The second readings could not be loaded.");
    }
    for (const row of data) {
      const pageId = field(row, "page_id");
      const text = field(row, "raw_text");
      if (typeof pageId !== "string" || typeof text !== "string") {
        throw new Error("A second reading could not be read.");
      }
      found.set(pageId, text);
    }
  }
  return found;
}

async function hasRows(client: SourcesClient, table: "page_gaps" | "corrections", pageId: string): Promise<boolean> {
  const query = client.from(table).select("page_id").eq("page_id", pageId);
  const { data, error } = await (table === "corrections" ? query.eq("corrected_text", "") : query).limit(1);
  if (error || !Array.isArray(data)) {
    throw new Error("The edits of a page could not be loaded.");
  }
  return data.length > 0;
}

async function wasEdited(client: SourcesClient, pageId: string): Promise<boolean> {
  const [gaps, deletions] = await Promise.all([hasRows(client, "page_gaps", pageId), hasRows(client, "corrections", pageId)]);
  return gaps || deletions;
}

export async function readExportSources(client: SourcesClient, ids: string[]): Promise<Map<string, ExportSource>> {
  const sources = new Map<string, ExportSource>();
  if (ids.length === 0) {
    return sources;
  }
  const seconds = await secondReadings(client, ids);
  const edited = new Map<string, boolean>();
  for (let from = 0; from < ids.length; from += PARALLEL) {
    const group = ids.slice(from, from + PARALLEL);
    const answers = await Promise.all(group.map((id) => wasEdited(client, id)));
    group.forEach((id, index) => edited.set(id, answers[index]));
  }
  for (const id of ids) {
    sources.set(id, { second: seconds.get(id) ?? null, edited: edited.get(id) ?? false });
  }
  return sources;
}
