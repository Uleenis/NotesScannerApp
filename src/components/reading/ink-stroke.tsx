import { useEffect } from "react";
import Animated, { Easing, cancelAnimation, useAnimatedProps, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { STROKE_CYCLE_MS, STROKE_DRAW_MS } from "@/pages/timing";
import { colors } from "@/theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const PATH = "M3 9 C22 2 44 15 74 8 S126 2 145 9";
const PATH_LENGTH = 144;
const VIEW_WIDTH = 148;
const VIEW_HEIGHT = 16;
const STROKE_WIDTH = 3;

type Props = { tone: "blue" | "rule" | "ink"; animated: boolean; width?: number };

function AnimatedStroke({ color, width }: { color: string; width: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    const easing = Easing.inOut(Easing.cubic);
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: STROKE_DRAW_MS, easing }),
        withTiming(2, { duration: STROKE_CYCLE_MS - STROKE_DRAW_MS, easing }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: progress.value <= 1 ? PATH_LENGTH * (1 - progress.value) : -PATH_LENGTH * (progress.value - 1),
  }));

  return (
    <Svg width={width} height={(width * VIEW_HEIGHT) / VIEW_WIDTH} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
      <AnimatedPath
        d={PATH}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={[PATH_LENGTH, PATH_LENGTH]}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}

export function InkStroke({ tone, animated, width = VIEW_WIDTH }: Props) {
  const color = colors[tone];

  if (animated) {
    return <AnimatedStroke color={color} width={width} />;
  }

  return (
    <Svg width={width} height={(width * VIEW_HEIGHT) / VIEW_WIDTH} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
      <Path d={PATH} stroke={color} strokeWidth={STROKE_WIDTH} strokeLinecap="round" fill="none" />
    </Svg>
  );
}
