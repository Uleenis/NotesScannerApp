import { field } from "@/capture/api";
import type { PagesClient } from "./pages";

export async function readSecond(client: PagesClient, pageId: string): Promise<string | null> {
  const { data, error } = await client.from("readings").select("raw_text").eq("page_id", pageId).eq("label", "B2").limit(1);
  if (error || !Array.isArray(data)) {
    throw new Error("The second reading could not be loaded.");
  }
  if (data.length === 0) {
    return null;
  }
  const text = field(data[0], "raw_text");
  if (typeof text !== "string") {
    throw new Error("The second reading could not be read.");
  }
  return text;
}
