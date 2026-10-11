import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { CAMERA_SHAPE } from "@/components/capture/viewfinder";
import { PrimaryButton } from "@/components/primary-button";
import { displayedSize } from "@/components/reading/zoomable-photo";
import { SecondaryButton } from "@/components/secondary-button";
import { useStrings } from "@/i18n";
import { colors, radius, typography } from "@/theme";

type Props = {
  title: string;
  photoUri: string;
  message: string | null;
  sending: boolean;
  turning: boolean;
  onRetake: () => void;
  onRotate: () => void;
  onRead: () => void;
};

export function PhotoReview({ title, photoUri, message, sending, turning, onRetake, onRotate, onRead }: Props) {
  const t = useStrings();
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [shape, setShape] = useState(CAMERA_SHAPE);
  const frame = displayedSize(shape, area);

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setArea({ width, height });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View onLayout={onLayout} style={styles.photoArea} testID="photo-review-area">
        <View style={[styles.photoFrame, { height: frame.height, width: frame.width }]} testID="photo-review-frame">
          <Image
            onLoad={(event) => setShape({ width: event.nativeEvent.source.width, height: event.nativeEvent.source.height })}
            resizeMode="contain"
            source={{ uri: photoUri }}
            style={styles.photo}
            testID="photo-review"
          />
        </View>
      </View>
      <Pressable
        accessibilityLabel={t.capture.rotateLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: sending || turning }}
        disabled={sending || turning}
        hitSlop={8}
        onPress={onRotate}
        style={[styles.rotate, (sending || turning) && styles.disabled]}
      >
        <Ionicons name="refresh" size={20} color={colors.ink} />
        <Text style={styles.rotateLabel}>{t.capture.rotate}</Text>
      </Pressable>
      {message === null ? null : <Text style={styles.message}>{message}</Text>}
      <View style={styles.buttons}>
        <View style={styles.button}>
          <SecondaryButton disabled={sending} label={t.capture.retake} onPress={onRetake} />
        </View>
        <View style={styles.button}>
          <PrimaryButton disabled={sending || turning} label={sending ? t.capture.sending : t.capture.read} onPress={onRead} />
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
  photoArea: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  photoFrame: {
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  photo: {
    flex: 1,
  },
  rotate: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  rotateLabel: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
  disabled: {
    opacity: 0.5,
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
