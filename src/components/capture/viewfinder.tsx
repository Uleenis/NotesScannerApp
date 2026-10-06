import { CameraView } from "expo-camera";
import { forwardRef } from "react";
import { StyleSheet, View } from "react-native";

import { colors, radius } from "@/theme";

type Props = { flash: boolean; onReady: () => void };

const CORNER = 36;

export const Viewfinder = forwardRef<CameraView, Props>(function Viewfinder({ flash, onReady }, ref) {
  return (
    <View style={styles.frame}>
      <CameraView ref={ref} facing="back" flash={flash ? "on" : "off"} onCameraReady={onReady} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[styles.corner, styles.topLeft]} />
      <View pointerEvents="none" style={[styles.corner, styles.topRight]} />
      <View pointerEvents="none" style={[styles.corner, styles.bottomLeft]} />
      <View pointerEvents="none" style={[styles.corner, styles.bottomRight]} />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.ink,
    borderRadius: radius.block,
    flex: 1,
    overflow: "hidden",
  },
  corner: {
    borderColor: colors.paper,
    height: CORNER,
    position: "absolute",
    width: CORNER,
  },
  topLeft: { borderLeftWidth: 3, borderTopWidth: 3, left: 24, top: 24 },
  topRight: { borderRightWidth: 3, borderTopWidth: 3, right: 24, top: 24 },
  bottomLeft: { borderBottomWidth: 3, borderLeftWidth: 3, bottom: 24, left: 24 },
  bottomRight: { borderBottomWidth: 3, borderRightWidth: 3, bottom: 24, right: 24 },
});
