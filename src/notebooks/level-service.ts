import { getSupabase } from "@/lib/supabase";
import { fetchLevel, setLevel, type CorrectionLevel } from "./level";

export const levelService = {
  get: (id: string) => fetchLevel(getSupabase(), id),
  set: (id: string, level: CorrectionLevel) => setLevel(getSupabase(), id, level),
};
