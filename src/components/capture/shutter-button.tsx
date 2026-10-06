import { Pressable, StyleSheet, View } from "react-native";

import { useStrings } from "@/i18n";
import { colors } from "@/theme";

export function ShutterButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const t = useStrings();

  return (
    <Pressable
      accessibilityLabel={t.capture.shutterLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.ring, disabled && styles.disabled]}
    >
      <View style={styles.dot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: "center",
    borderColor: colors.ink,
    borderRadius: 40,
    borderWidth: 3,
    height: 80,
    justifyContent: "center",
    width: 80,
  },
  dot: {
    backgroundColor: colors.ink,
    borderRadius: 31,
    height: 62,
    width: 62,
  },
  disabled: {
    opacity: 0.5,
  },
});
