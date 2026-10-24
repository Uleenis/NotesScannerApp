import { usePathname } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";

import { cancelExport, currentExport, currentProgress, subscribeToExport } from "@/export/activity";
import { sweepExports } from "@/export/files";
import { useStrings } from "@/i18n";
import { colors, radius, typography } from "@/theme";

const MODAL_PATHS: readonly string[] = ["/account"];

export function ExportHost({ embedded = false }: { embedded?: boolean }) {
  const t = useStrings();
  const pathname = usePathname();
  const running = useSyncExternalStore(subscribeToExport, currentExport, currentExport) !== null;
  const progress = useSyncExternalStore(subscribeToExport, currentProgress, currentProgress);

  useEffect(() => {
    if (!embedded) {
      sweepExports();
    }
  }, [embedded]);

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

  if (!running || (!embedded && MODAL_PATHS.includes(pathname))) {
    return null;
  }

  return (
    <View accessibilityViewIsModal style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator color={colors.ink} />
        <Text accessibilityLiveRegion="polite" style={styles.label}>
          {progress === null ? t.export.preparing : t.myData.progress(progress.done, progress.total)}
        </Text>
        {progress === null ? null : (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress.total === 0 ? 100 : Math.round((progress.done / progress.total) * 100)}%` }]} />
          </View>
        )}
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
  track: {
    backgroundColor: colors.rule,
    borderRadius: 2,
    height: 4,
    overflow: "hidden",
    width: 200,
  },
  fill: {
    backgroundColor: colors.blue,
    height: 4,
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
