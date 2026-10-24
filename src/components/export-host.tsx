import { useEffect, useSyncExternalStore } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";

import { cancelExport, currentExport, subscribeToExport } from "@/export/activity";
import { sweepExports } from "@/export/files";
import { useStrings } from "@/i18n";
import { colors, radius, typography } from "@/theme";

export function ExportHost() {
  const t = useStrings();
  const running = useSyncExternalStore(subscribeToExport, currentExport, currentExport) !== null;

  useEffect(() => {
    sweepExports();
  }, []);

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      cancelExport();
      return true;
    });
    return () => subscription.remove();
  }, [running]);

  if (!running) {
    return null;
  }

  return (
    <View accessibilityViewIsModal style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator color={colors.ink} />
        <Text accessibilityLiveRegion="polite" style={styles.label}>
          {t.export.preparing}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t.common.cancel} onPress={cancelExport} style={styles.cancel}>
          <Text style={styles.cancelText}>{t.common.cancel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: "center",
    backgroundColor: colors.scrim,
    bottom: 0,
    elevation: 30,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1100,
  },
  card: {
    alignItems: "center",
    backgroundColor: colors.sheet,
    borderRadius: radius.block,
    gap: 12,
    marginHorizontal: 32,
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  label: {
    ...typography.interfaceBody,
    color: colors.ink,
    textAlign: "center",
  },
  cancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelText: {
    ...typography.interfaceBody,
    color: colors.blue,
  },
});
