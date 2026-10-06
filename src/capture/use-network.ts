import { useNetworkState } from "expo-network";

export function useOffline(): boolean {
  const state = useNetworkState();
  return state.isConnected === false || state.isInternetReachable === false;
}
