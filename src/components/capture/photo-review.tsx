import { Image, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { SecondaryButton } from "@/components/secondary-button";
import { useStrings } from "@/i18n";
import { colors, radius, typography } from "@/theme";

type Props = {
  title: string;
  photoUri: string;
  message: string | null;
  sending: boolean;
  onRetake: () => void;
  onRead: () => void;
};

export function PhotoReview({ title, photoUri, message, sending, onRetake, onRead }: Props) {
  const t = useStrings();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.photoFrame}>
        <Image resizeMode="contain" source={{ uri: photoUri }} style={styles.photo} />
      </View>
      {message === null ? null : <Text style={styles.message}>{message}</Text>}
      <View style={styles.buttons}>
        <View style={styles.button}>
          <SecondaryButton disabled={sending} label={t.capture.retake} onPress={onRetake} />
        </View>
        <View style={styles.button}>
          <PrimaryButton disabled={sending} label={sending ? t.capture.sending : t.capture.read} onPress={onRead} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
  },
  title: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontWeight: "600",
    textAlign: "center",
  },
  photoFrame: {
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    overflow: "hidden",
  },
  photo: {
    flex: 1,
  },
  message: {
    ...typography.interfaceSecondary,
    color: colors.ink,
    textAlign: "center",
  },
  buttons: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
  },
});
