import { getSupabase } from "@/lib/supabase";
import { confirmParent, fetchTrainingState, grantConsent, requestParent, revokeTraining, saveAge } from "./api";

export const trainingService = {
  state: (userId: string) => fetchTrainingState(getSupabase(), userId),
  saveAge: (userId: string, birthYear: number, country: string) => saveAge(getSupabase(), userId, birthYear, country),
  grantConsent: () => grantConsent(getSupabase()),
  requestParent: (email: string) => requestParent(getSupabase(), email),
  confirmParent: (code: string) => confirmParent(getSupabase(), code),
  revoke: () => revokeTraining(getSupabase()),
};

export type TrainingService = typeof trainingService;
