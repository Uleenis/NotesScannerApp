import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider } from "@/auth/auth-provider";
import { defaultAuthServices } from "@/auth/default-services";
import { ForgetOtherAccounts } from "@/components/forget-other-accounts";
import { createQueryClient, followAppFocus } from "@/lib/query-client";
import { stackScreenOptions } from "@/navigation-options";
import { colors, fontAssets } from "@/theme";

SplashScreen.preventAutoHideAsync();

export const unstable_settings = { anchor: "index" };

export default function RootLayout() {
  const [loaded, error] = useFonts(fontAssets);
  const ready = loaded || error !== null;
  const [queryClient] = useState(createQueryClient);

  useEffect(followAppFocus, []);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <AuthProvider services={defaultAuthServices}>
        <QueryClientProvider client={queryClient}>
          <ForgetOtherAccounts />
          <StatusBar style="dark" />
          <Stack screenOptions={stackScreenOptions}>
            <Stack.Screen name="index" />
            <Stack.Screen name="capture" options={{ presentation: "fullScreenModal", headerShown: false }} />
            <Stack.Screen
              name="limit"
              options={{
                presentation: "formSheet",
                headerShown: false,
                sheetAllowedDetents: "fitToContents",
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: colors.sheet },
              }}
            />
            <Stack.Screen
              name="page/[id]/photo"
              options={{
                presentation: "formSheet",
                headerShown: false,
                sheetAllowedDetents: [0.5, 1],
                sheetLargestUndimmedDetentIndex: 0,
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: colors.sheet },
              }}
            />
            <Stack.Screen
              name="page/[id]/move"
              options={{
                presentation: "formSheet",
                headerShown: false,
                sheetAllowedDetents: [0.5, 1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: colors.sheet },
              }}
            />
            <Stack.Screen name="account" options={{ presentation: "modal" }} />
            <Stack.Screen name="new-notebook" options={{ presentation: "modal" }} />
            <Stack.Screen name="new-chapter" options={{ presentation: "modal" }} />
            <Stack.Screen name="rename" options={{ presentation: "modal" }} />
            <Stack.Screen name="sign-in" options={{ presentation: "modal", headerShown: false }} />
          </Stack>
        </QueryClientProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
