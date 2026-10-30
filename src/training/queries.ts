import { useQuery, type QueryClient } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-provider";
import { trainingService } from "./service";

export function useTrainingState() {
  const auth = useAuth();
  const userId = auth.userId;
  return useQuery({
    queryKey: ["training", userId],
    queryFn: () => trainingService.state(userId ?? ""),
    enabled: auth.status === "ready" && !auth.isAnonymous && userId !== null,
  });
}

export function trainingStageQuery(userId: string | null) {
  return {
    queryKey: ["training-stage", userId] as const,
    queryFn: () => trainingService.stage(),
    staleTime: 0,
  };
}

export function useTrainingStage() {
  const auth = useAuth();
  return useQuery({
    ...trainingStageQuery(auth.userId),
    enabled: auth.status === "ready" && !auth.isAnonymous && auth.userId !== null,
  });
}

export function refreshTraining(queryClient: QueryClient, userId: string | null): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["training", userId] }),
    queryClient.invalidateQueries({ queryKey: ["training-stage", userId] }),
  ]).then(() => undefined);
}
