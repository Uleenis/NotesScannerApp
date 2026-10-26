import { useState } from "react";
import { Image, PixelRatio, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { frameOf } from "@/pages/frame";
import { colors } from "@/theme";
import { FrameOverlay } from "./frame-overlay";

const MIN_MAX_SCALE = 2;
const MAX_MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 2.5;
const ZOOM_MS = 220;
const ZOOMED = 1.01;

type Size = { width: number; height: number };

export function maxScaleFor(photo: Size, displayed: Size, density: number): number {
  if (displayed.width <= 0 || photo.width <= 0) {
    return MIN_MAX_SCALE;
  }
  return Math.min(MAX_MAX_SCALE, Math.max(MIN_MAX_SCALE, photo.width / (displayed.width * density)));
}

export function displayedSize(photo: Size, box: Size): Size {
  if (photo.width <= 0 || photo.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { width: box.width, height: box.height };
  }
  const fit = Math.min(box.width / photo.width, box.height / photo.height);
  return { width: photo.width * fit, height: photo.height * fit };
}

type Props = { uri: string; label: string; found?: readonly number[] | null; foundPixels?: Size | null; foundLabel?: string };

export function ZoomablePhoto({ uri, label, found = null, foundPixels = null, foundLabel = "" }: Props) {
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [photo, setPhoto] = useState<Size>({ width: 0, height: 0 });

  const displayed = displayedSize(photo, box);
  const maxScale = maxScaleFor(photo, displayed, PixelRatio.get());
  const frame = found === null || foundPixels === null || photo.width === 0 ? null : frameOf(found, foundPixels);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  function bounds(nextScale: number) {
    "worklet";
    return {
      x: Math.max(0, (displayed.width * nextScale - displayed.width) / 2),
      y: Math.max(0, (displayed.height * nextScale - displayed.height) / 2),
    };
  }

  function clamp(value: number, limit: number) {
    "worklet";
    return Math.min(limit, Math.max(-limit, value));
  }

  function reset() {
    "worklet";
    scale.value = withTiming(1, { duration: ZOOM_MS });
    translateX.value = withTiming(0, { duration: ZOOM_MS });
    translateY.value = withTiming(0, { duration: ZOOM_MS });
  }

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      const next = Math.min(maxScale, Math.max(1, startScale.value * event.scale));
      const ratio = next / startScale.value;
      const focalX = event.focalX - displayed.width / 2;
      const focalY = event.focalY - displayed.height / 2;
      const limit = bounds(next);
      scale.value = next;
      translateX.value = clamp(focalX - ratio * (focalX - startX.value), limit.x);
      translateY.value = clamp(focalY - ratio * (focalY - startY.value), limit.y);
    })
    .onEnd(() => {
      if (scale.value < ZOOMED) {
        reset();
      }
    });

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_event, state) => {
      if (scale.value > ZOOMED) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      const limit = bounds(scale.value);
      translateX.value = clamp(startX.value + event.translationX, limit.x);
      translateY.value = clamp(startY.value + event.translationY, limit.y);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event) => {
      if (scale.value > ZOOMED) {
        reset();
        return;
      }
      const target = Math.min(maxScale, DOUBLE_TAP_SCALE);
      const limit = bounds(target);
      scale.value = withTiming(target, { duration: ZOOM_MS });
      translateX.value = withTiming(clamp((event.x - displayed.width / 2) * (1 - target), limit.x), { duration: ZOOM_MS });
      translateY.value = withTiming(clamp((event.y - displayed.height / 2) * (1 - target), limit.y), { duration: ZOOM_MS });
    });

  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setBox({ width, height });
  }

  return (
    <View style={styles.box} onLayout={onLayout} testID="zoomable-photo">
      <ScrollView
        scrollEnabled={false}
        nestedScrollEnabled
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        style={[styles.area, { height: displayed.height, width: displayed.width }]}
        contentContainerStyle={styles.areaContent}
      >
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.layer, animatedStyle]}>
            <Image
              source={{ uri }}
              resizeMode="contain"
              accessibilityLabel={label}
              onLoad={(event) => setPhoto({ width: event.nativeEvent.source.width, height: event.nativeEvent.source.height })}
              style={styles.image}
            />
            {frame === null ? null : <FrameOverlay frame={frame} label={foundLabel} />}
          </Animated.View>
        </GestureDetector>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  area: {
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
    overflow: "hidden",
  },
  areaContent: {
    flexGrow: 1,
  },
  layer: {
    flex: 1,
  },
  image: {
    height: "100%",
    width: "100%",
  },
});
