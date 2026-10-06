import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth/auth-provider";
import { blockFor } from "@/capture/allowance";
import { limitParams } from "@/capture/limit-route";
import { freshAllowance, useAllowance } from "@/capture/queries";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

export function ScanButton({ notebookId }: { notebookId?: string }) {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  useAllowance();
  const opening = useRef(false);

  async function open() {
    if (opening.current) {
      return;
    }
    opening.current = true;
    try {
      const block = blockFor(await freshAllowance(queryClient, userId));
      if (block !== null) {
        router.push({ pathname: "/limit", params: limitParams(block) });
        return;
      }
      router.push(notebookId === undefined ? "/capture" : { pathname: "/capture", params: { notebook: notebookId } });
    } finally {
      opening.current = false;
    }
  }

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom: insets.bottom + 24 }]}>
      <Pressable accessibilityRole="button" onPress={() => void open()} style={styles.button}>
        <Ionicons name="camera-outline" size={24} color={colors.paper} />
        <Text style={styles.label}>{t.common.scan}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 999,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 28,
    paddingVertical: 18,
  },
  label: {
    ...typography.interfaceBody,
    color: colors.paper,
    fontWeight: "600",
  },
});
