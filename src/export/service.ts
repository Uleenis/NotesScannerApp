import { getSupabase } from "@/lib/supabase";
import { renderTex, type DrawnTex } from "@/pages/tex";
import { saveExport, shareExport } from "./files";
import type { ExportDeps } from "./run";
import { readRenderings } from "@/render/api";
import { readExportSources } from "./sources";

const DRAW_ATTEMPTS = 5;

async function drawFormula(tex: string, display: boolean): Promise<DrawnTex | null> {
  for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt += 1) {
    const drawn = await renderTex(tex, display);
    if (drawn !== undefined) {
      return drawn;
    }
  }
  return null;
}

export const exportDeps: ExportDeps = {
  sources: (ids, control) => readExportSources(getSupabase(), ids, control),
  renderings: (ids, control) => readRenderings(getSupabase(), ids, control),
  draw: drawFormula,
  save: saveExport,
  share: shareExport,
  log: (event, failure) => console.warn(event, failure),
};
