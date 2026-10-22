import { field } from "@/capture/api";
import type { PagesClient } from "./pages";

export type ShownAlert = "missing_line" | "math_incomplete";

const SHOWN: readonly string[] = ["missing_line", "math_incomplete"];

export async function listAlerts(client: PagesClient, pageId: string): Promise<ShownAlert[]> {
  const { data, error } = await client.from("page_alerts").select("kind").eq("page_id", pageId).order("kind");
  if (error || !Array.isArray(data)) {
    throw new Error("The alerts could not be loaded.");
  }
  const kinds = data.map((row) => {
    const kind = field(row, "kind");
    if (typeof kind !== "string") {
      throw new Error("An alert could not be read.");
    }
    return kind;
  });
  return kinds.filter((kind): kind is ShownAlert => SHOWN.includes(kind));
}
