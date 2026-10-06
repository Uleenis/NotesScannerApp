import { useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export type CameraAccess = "loading" | "granted" | "denied";

export function useCameraAccess(): CameraAccess {
  const [permission, request, refresh] = useCameraPermissions();
  const asked = useRef(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (permission !== null && !permission.granted && permission.canAskAgain && !asked.current) {
      asked.current = true;
      setAsking(true);
      request().finally(() => setAsking(false));
    }
  }, [permission, request]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  if (permission === null || asking) {
    return "loading";
  }
  return permission.granted ? "granted" : "denied";
}
