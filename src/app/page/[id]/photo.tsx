import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ZoomablePhoto } from "@/components/reading/zoomable-photo";
import { useStrings } from "@/i18n";
import { dateParts } from "@/pages/dates";
import { usePage, usePhotoUrl } from "@/pages/queries";
import { colors, typography } from "@/theme";

export default function PhotoSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const page = usePage(id);
  const photo = usePhotoUrl(id);
  const parts = page.data === undefined || page.data === null ? null : dateParts(page.data.capturedAt, new Date());

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.close}>
          <Text style={styles.closeLabel}>{t.photo.close}</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>
          {t.photo.title}
        </Text>
        <View style={styles.close} />
      </View>
      <View style={styles.photo}>
        {photo.data !== undefined ? (
          <ZoomablePhoto uri={photo.data} label={t.photo.label} />
        ) : photo.isError ? (
          <Text style={styles.error}>{t.photo.loadFailed}</Text>
        ) : null}
      </View>
      {parts === null ? null : <Text style={styles.taken}>{t.dates.takenAt(parts.day, parts.month, parts.year, parts.time)}</Text>}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.sheet,
    flex: 1,
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12,
  },
  close: {
    width: 80,
  },
  closeLabel: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
  title: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontWeight: "600",
  },
  photo: {
    flex: 1,
  },
  error: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  taken: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingTop: 12,
    textAlign: "center",
  },
});
