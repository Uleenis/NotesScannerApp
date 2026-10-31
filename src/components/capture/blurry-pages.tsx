import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { useStrings } from "@/i18n";
import { colors, radius, typography } from "@/theme";

export type BlurryPage = { index: number; uri: string };

type Props = { pages: BlurryPage[]; onRetake: (index: number) => void; onSendAnyway: () => void };

export function BlurryPages({ pages, onRetake, onSendAnyway }: Props) {
  const t = useStrings();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t.capture.blurryTitle(pages.length)}</Text>
      <Text style={styles.body}>{t.capture.blurryBody}</Text>
      <ScrollView contentContainerStyle={styles.list} style={styles.scroll}>
        {pages.map((page) => (
          <View key={page.uri} style={styles.row}>
            <Image resizeMode="cover" source={{ uri: page.uri }} style={styles.thumbnail} />
            <Text style={styles.page}>{t.capture.blurryPage(page.index + 1)}</Text>
            <Pressable
              accessibilityLabel={t.capture.blurryPageLabel(page.index + 1)}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => onRetake(page.index)}
              style={styles.retake}
            >
              <Text style={styles.retakeLabel}>{t.capture.retake}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <PrimaryButton label={t.capture.sendAnyway} onPress={onSendAnyway} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
  },
  title: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontWeight: "600",
    textAlign: "center",
  },
  body: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  list: {
    gap: 10,
  },
  row: {
    alignItems: "center",
    borderColor: colors.rule,
    borderRadius: radius.block,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  thumbnail: {
    backgroundColor: colors.rule,
    borderRadius: radius.control,
    height: 64,
    width: 48,
  },
  page: {
    ...typography.interfaceBody,
    color: colors.ink,
    flex: 1,
  },
  retake: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  retakeLabel: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontWeight: "600",
  },
});
