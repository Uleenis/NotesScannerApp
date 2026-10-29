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

export function refreshTraining(queryClient: QueryClient, userId: string | null): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ["training", userId] });
}
