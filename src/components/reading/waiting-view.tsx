import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/primary-button";
import { SecondaryButton } from "@/components/secondary-button";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";
import { InkStroke } from "./ink-stroke";

export type ViewAction = { label: string; onPress: () => void; disabled?: boolean };

type Props = {
  pageNumber: number;
  photoUrl: string | undefined;
  stroke: "writing" | "still";
  title: string;
  body: string;
  notice?: string | null;
  primary?: ViewAction;
  secondary?: ViewAction;
};

export function WaitingView({ pageNumber, photoUrl, stroke, title, body, notice = null, primary, secondary }: Props) {
  const t = useStrings();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.pageNumber}>{t.document.pageNumber(pageNumber)}</Text>
        <View style={styles.frame}>
          {photoUrl === undefined ? null : (
            <Image source={{ uri: photoUrl }} resizeMode="contain" accessibilityLabel={t.photo.label} style={styles.photo} />
          )}
        </View>
        <View style={styles.stroke}>
          <InkStroke tone={stroke === "writing" ? "blue" : "rule"} animated={stroke === "writing"} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>
        {notice === null ? null : <Text style={styles.notice}>{notice}</Text>}
      </ScrollView>
      <View style={[styles.buttons, { paddingBottom: insets.bottom + 16 }]}>
        {primary === undefined ? null : <PrimaryButton label={primary.label} onPress={primary.onPress} disabled={primary.disabled} />}
        {secondary === undefined ? null : <SecondaryButton label={secondary.label} onPress={secondary.onPress} disabled={secondary.disabled} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  pageNumber: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
  frame: {
    alignSelf: "stretch",
    backgroundColor: colors.paper,
    borderColor: colors.rule,
    borderWidth: StyleSheet.hairlineWidth,
    height: 280,
  },
  photo: {
    height: "100%",
    width: "100%",
  },
  stroke: {
    paddingTop: 16,
  },
  title: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  body: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  notice: {
    ...typography.interfaceSecondary,
    color: colors.ink,
    textAlign: "center",
  },
  buttons: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
});
