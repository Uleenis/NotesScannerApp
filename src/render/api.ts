import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { field, looksLikeNetworkFailure } from "@/capture/api";
import { stripUnderline } from "@/pages/clean";
import type { PagesClient } from "@/pages/pages";
import { sha256 } from "./sha256";

export const MAX_RENDERINGS_PER_READ = 50;

export type StoredRendering = { text: string; basedOn: string };

export type RenderOutcome =
  | { status: "ready"; text: string }
  | { status: "limit" | "failed" | "discarded" }
  | { status: "network" }
  | { status: "error" };

export type RenderingsClient = Pick<PagesClient, "from">;

export function renderingFingerprint(storedText: string): string {
  return sha256(stripUnderline(storedText));
}

export async function renderPage(client: PagesClient, pageId: string): Promise<RenderOutcome> {
  try {
    const { data, error } = await client.functions.invoke("render-page", { body: { page_id: pageId } });
    if (error instanceof FunctionsFetchError) {
      return { status: "network" };
    }
    if (error || typeof data !== "object" || data === null) {
      return { status: "error" };
    }
    const status = field(data, "status");
    if (status === "limit" || status === "failed" || status === "discarded") {
      return { status };
    }
    const text = field(data, "text");
    if (status === "ready" && typeof text === "string" && text !== "") {
      return { status, text };
    }
    return { status: "error" };
  } catch (error) {
    return { status: error instanceof FunctionsHttpError || !looksLikeNetworkFailure(error) ? "error" : "network" };
  }
}

function stored(row: unknown): StoredRendering {
  const text = field(row, "text");
  const basedOn = field(row, "based_on");
  if (typeof text !== "string" || typeof basedOn !== "string") {
    throw new Error("A rendering could not be read.");
  }
  return { text, basedOn };
}

export async function readRendering(client: RenderingsClient, pageId: string): Promise<StoredRendering | null> {
  const { data, error } = await client.from("page_renderings").select("text, based_on").eq("page_id", pageId).limit(1);
  if (error || !Array.isArray(data)) {
    throw new Error("The rendering could not be loaded.");
  }
  return data.length === 0 ? null : stored(data[0]);
}

export async function readRenderings(client: RenderingsClient, ids: string[], control: { cancelled: boolean } = { cancelled: false }): Promise<Map<string, StoredRendering>> {
  const found = new Map<string, StoredRendering>();
  for (let from = 0; from < ids.length && !control.cancelled; from += MAX_RENDERINGS_PER_READ) {
    const { data, error } = await client
      .from("page_renderings")
      .select("page_id, text, based_on")
      .in("page_id", ids.slice(from, from + MAX_RENDERINGS_PER_READ));
    if (error || !Array.isArray(data)) {
      throw new Error("The renderings could not be loaded.");
    }
    for (const row of data) {
      const pageId = field(row, "page_id");
      if (typeof pageId !== "string") {
        throw new Error("A rendering could not be read.");
      }
      found.set(pageId, stored(row));
    }
  }
  return found;
}
