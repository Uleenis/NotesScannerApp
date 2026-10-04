import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

export function ScanButton() {
  const t = useStrings();
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom: insets.bottom + 24 }]}>
      <Pressable accessibilityRole="button" onPress={() => router.push("/capture")} style={styles.button}>
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
