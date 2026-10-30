import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Alert } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { useStrings } from "@/i18n";
import { showMenu, type MenuItem } from "@/lib/action-menu";
import { trainingStageQuery } from "@/training/queries";
import type { TrainingStage } from "@/training/api";
import { CORRECTION_LEVELS, type CorrectionLevel, type SetLevelResult } from "./level";
import { levelService } from "./level-service";

export function useLevelItem(notebookId: string): MenuItem {
  const t = useStrings();
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const stageNow = useCallback(() => queryClient.fetchQuery(trainingStageQuery(userId)), [queryClient, userId]);

  const explain = useCallback(
    async (result: SetLevelResult) => {
      switch (result.status) {
        case "requires_model":
          Alert.alert(t.notebook.level.blocked[await stageNow().catch((): TrainingStage => "in_service")]);
          return;
        case "offline":
          Alert.alert(t.notebook.level.offline);
          return;
        case "set":
          return;
        default:
          Alert.alert(t.notebook.level.failed);
      }
    },
    [stageNow, t],
  );

  const choose = useCallback(
    async (level: CorrectionLevel, stage: TrainingStage) => {
      if (level !== "course" && stage !== "in_service") {
        Alert.alert(t.notebook.level.blocked[stage]);
        return;
      }
      await explain(await levelService.set(notebookId, level).catch((): SetLevelResult => ({ status: "failed" })));
    },
    [explain, notebookId, t],
  );

  const open = useCallback(async () => {
    try {
      const [current, stage] = await Promise.all([
        queryClient.fetchQuery({ queryKey: ["level", userId, notebookId], queryFn: () => levelService.get(notebookId), staleTime: 0 }),
        stageNow(),
      ]);
      if (current === null) {
        Alert.alert(t.notebook.level.loadFailed);
        return;
      }
      showMenu(
        CORRECTION_LEVELS.map((level) => {
          const name = t.notebook.level.names[level];
          return level === current
            ? { label: t.notebook.level.current(name), onPress: () => undefined }
            : { label: name, onPress: () => void choose(level, stage) };
        }),
        t.common.cancel,
      );
    } catch {
      Alert.alert(t.notebook.level.loadFailed);
    }
  }, [choose, notebookId, queryClient, stageNow, t, userId]);

  return { label: t.notebook.level.label, onPress: () => void open() };
}
