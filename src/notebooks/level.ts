import type { SupabaseClient } from "@supabase/supabase-js";

import { call } from "@/training/api";

export const CORRECTION_LEVELS = ["course", "journal", "grammar"] as const;

export type CorrectionLevel = (typeof CORRECTION_LEVELS)[number];

export type LevelClient = Pick<SupabaseClient, "from" | "functions">;

export type SetLevelResult =
  | { status: "set"; level: CorrectionLevel }
  | { status: "requires_model" }
  | { status: "missing" }
  | { status: "offline" }
  | { status: "failed" };

function levelOf(value: unknown): CorrectionLevel {
  return CORRECTION_LEVELS.find((level) => level === value) ?? "course";
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value ? (value as Record<string, unknown>)[name] : undefined;
}

export async function fetchLevel(client: Pick<SupabaseClient, "from">, id: string): Promise<CorrectionLevel | null> {
  const { data, error } = await client.from("notebooks").select("correction_level").eq("id", id).maybeSingle();
  if (error) {
    throw new Error("The level of the notebook could not be loaded.");
  }
  return data === null || data === undefined ? null : levelOf(field(data, "correction_level"));
}

export async function setLevel(client: Pick<SupabaseClient, "functions">, id: string, level: CorrectionLevel): Promise<SetLevelResult> {
  const answer = await call(client, "set-correction-level", { notebook_id: id, level });
  switch (answer.kind) {
    case "done":
      return field(answer.data, "level") === level ? { status: "set", level } : { status: "failed" };
    case "offline":
      return { status: "offline" };
    case "refused":
      if (answer.code === "requires_model") {
        return { status: "requires_model" };
      }
      return answer.code === "notebook_not_found" ? { status: "missing" } : { status: "failed" };
    default:
      return { status: "failed" };
  }
}
