import { useOnline } from "@/offline/network";

export function useOffline(): boolean {
  return !useOnline();
}
