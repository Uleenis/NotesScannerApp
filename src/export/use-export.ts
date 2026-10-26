import { useCallback } from "react";
import { Alert } from "react-native";

import { useLanguage, useStrings } from "@/i18n";
import { useRenderMode } from "@/render/mode";
import { showMenu, type MenuItem } from "@/lib/action-menu";
import { beginExport, endExport } from "./activity";
import type { ExportPlan } from "./document";
import { runExport, type ExportFormat, type ExportResult } from "./run";
import { exportDeps } from "./service";

export function useExportItem(): (plan: ExportPlan) => MenuItem {
  const t = useStrings();
  const language = useLanguage();
  const renderMode = useRenderMode();

  const message = useCallback(
    (result: ExportResult): string | null => {
      switch (result.status) {
        case "empty":
          return t.export.nothing;
        case "tooMany":
          return t.export.tooMany(result.max);
        case "tooLarge":
          return t.export.tooLarge;
        case "unavailable":
          return t.export.unavailable;
        case "error":
          return t.export.failed;
        default:
          return null;
      }
    },
    [t],
  );

  const start = useCallback(
    (plan: ExportPlan, format: ExportFormat) => {
      const control = beginExport();
      if (control === null) {
        return;
      }
      const labels = { pageNumber: t.document.pageNumber, fallbackName: t.export.fileName, language, enriched: renderMode === "enriched" };
      void runExport(plan, format, labels, control, exportDeps).then((result) => {
        endExport(control);
        const shown = message(result);
        if (shown !== null) {
          Alert.alert(shown);
        }
      });
    },
    [t, language, renderMode, message],
  );

  return useCallback(
    (plan) => ({
      label: t.export.label,
      onPress: () =>
        showMenu(
          [
            { label: t.export.pdf, onPress: () => start(plan, "pdf") },
            { label: t.export.markdown, onPress: () => start(plan, "markdown") },
          ],
          t.common.cancel,
        ),
    }),
    [t, start],
  );
}
