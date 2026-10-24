import { StyleSheet, View } from "react-native";

import type { Frame } from "@/pages/frame";
import { colors } from "@/theme";

const percent = (fraction: number): `${number}%` => `${Number((fraction * 100).toFixed(3))}%`;

export function FrameOverlay({ frame, label }: { frame: Frame; label: string }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        accessibilityLabel={label}
        style={[styles.frame, { left: percent(frame.left), top: percent(frame.top), width: percent(frame.width), height: percent(frame.height) }]}
      >
        <View style={styles.fill} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderColor: colors.ink,
    borderWidth: 2,
    position: "absolute",
  },
  fill: {
    backgroundColor: colors.highlight,
    flex: 1,
    opacity: 0.35,
  },
});
