import { useCallback } from "react";

import { useStrings } from "@/i18n";
import { whenOnline } from "./network";

export function useGate(): (action: () => void) => () => void {
  const t = useStrings();
  return useCallback((action) => () => whenOnline(t.offline.needsNetwork, action), [t]);
}
