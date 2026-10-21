import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOpenCapture } from "@/capture/use-open-capture";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

export function ScanButton({ notebookId, chapterId }: { notebookId?: string; chapterId?: string }) {
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const open = useOpenCapture(notebookId, chapterId);

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
