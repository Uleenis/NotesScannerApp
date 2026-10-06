import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { blockFor } from "@/capture/allowance";
import { limitParams } from "@/capture/limit-route";
import { useAllowance } from "@/capture/queries";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

export function ScanButton({ notebookId }: { notebookId?: string }) {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const allowance = useAllowance();

  function open() {
    const block = blockFor(allowance.data);
    if (block !== null) {
      router.push({ pathname: "/limit", params: limitParams(block) });
      return;
    }
    router.push(notebookId === undefined ? "/capture" : { pathname: "/capture", params: { notebook: notebookId } });
  }

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom: insets.bottom + 24 }]}>
      <Pressable accessibilityRole="button" onPress={open} style={styles.button}>
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
