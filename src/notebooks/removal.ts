import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

import { field, looksLikeNetworkFailure, refusalCode } from "@/capture/api";

export type LibraryClient = Pick<SupabaseClient, "functions">;

export type LibraryFailure = "busy" | "missing" | "network" | "error";

export type LibraryCall = { status: "answered"; data: unknown } | { status: LibraryFailure };

export type DeleteResult = { status: "deleted" } | { status: LibraryFailure };

const MISSING_CODES: readonly string[] = ["page_not_found", "notebook_not_found", "chapter_not_found"];

export async function callLibrary(client: LibraryClient, name: string, body: Record<string, string | null>): Promise<LibraryCall> {
  try {
    const { data, error } = await client.functions.invoke(name, { body });
    if (error instanceof FunctionsFetchError) {
      return { status: "network" };
    }
    if (error instanceof FunctionsHttpError) {
      const code = await refusalCode(error);
      if (code === "page_processing") {
        return { status: "busy" };
      }
      return { status: code !== null && MISSING_CODES.includes(code) ? "missing" : "error" };
    }
    return error ? { status: "error" } : { status: "answered", data };
  } catch (error) {
    return { status: looksLikeNetworkFailure(error) ? "network" : "error" };
  }
}

export async function callDeletion(client: LibraryClient, name: string, body: Record<string, string>): Promise<DeleteResult> {
  const call = await callLibrary(client, name, body);
  if (call.status !== "answered") {
    return { status: call.status };
  }
  return field(call.data, "deleted") === true ? { status: "deleted" } : { status: "error" };
}

export function deleteNotebook(client: LibraryClient, notebookId: string): Promise<DeleteResult> {
  return callDeletion(client, "delete-notebook", { notebook_id: notebookId });
}

export function deleteChapter(client: LibraryClient, chapterId: string): Promise<DeleteResult> {
  return callDeletion(client, "delete-chapter", { chapter_id: chapterId });
}
