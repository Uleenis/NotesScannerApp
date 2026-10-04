import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { AuthProvider } from "@/auth/auth-provider";
import { defaultAuthServices } from "@/auth/default-services";
import { stackScreenOptions } from "@/navigation-options";
import { fontAssets } from "@/theme";

SplashScreen.preventAutoHideAsync();

export const unstable_settings = { anchor: "index" };

export default function RootLayout() {
  const [loaded, error] = useFonts(fontAssets);
  const ready = loaded || error !== null;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <AuthProvider services={defaultAuthServices}>
      <StatusBar style="dark" />
      <Stack screenOptions={stackScreenOptions}>
        <Stack.Screen name="index" />
        <Stack.Screen name="capture" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="account" options={{ presentation: "modal" }} />
        <Stack.Screen name="sign-in" options={{ presentation: "modal", headerShown: false }} />
      </Stack>
    </AuthProvider>
  );
}
