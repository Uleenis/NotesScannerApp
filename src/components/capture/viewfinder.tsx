import { CameraView } from "expo-camera";
import { forwardRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { displayedSize } from "@/components/reading/zoomable-photo";
import { colors, radius } from "@/theme";

export const CAMERA_SHAPE = { width: 3, height: 4 };

type Props = { flash: boolean; onReady: () => void };

const CORNER = 36;

export const Viewfinder = forwardRef<CameraView, Props>(function Viewfinder({ flash, onReady }, ref) {
  const [area, setArea] = useState({ width: 0, height: 0 });
  const frame = displayedSize(CAMERA_SHAPE, area);

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setArea({ width, height });
  }

  return (
    <View onLayout={onLayout} style={styles.area} testID="viewfinder-area">
      <View style={[styles.frame, { height: frame.height, width: frame.width }]} testID="viewfinder">
        <CameraView
          autofocus="on"
          facing="back"
          flash={flash ? "on" : "off"}
          onCameraReady={onReady}
          ref={ref}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={[styles.corner, styles.topLeft]} />
        <View pointerEvents="none" style={[styles.corner, styles.topRight]} />
        <View pointerEvents="none" style={[styles.corner, styles.bottomLeft]} />
        <View pointerEvents="none" style={[styles.corner, styles.bottomRight]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  area: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  frame: {
    backgroundColor: colors.ink,
    borderRadius: radius.block,
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
