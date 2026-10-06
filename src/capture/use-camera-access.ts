import { useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export type CameraAccess = "loading" | "granted" | "denied";

export function useCameraAccess(): CameraAccess {
  const [permission, request, refresh] = useCameraPermissions();
  const requesting = useRef(false);
  const [asked, setAsked] = useState(false);
  const mustAsk = permission !== null && !permission.granted && permission.canAskAgain && !asked;

  useEffect(() => {
    if (!mustAsk || requesting.current) {
      return;
    }
    requesting.current = true;
    request()
      .catch(() => undefined)
      .finally(() => setAsked(true));
  }, [mustAsk, request]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  if (permission === null || mustAsk) {
    return "loading";
  }
  return permission.granted ? "granted" : "denied";
}
