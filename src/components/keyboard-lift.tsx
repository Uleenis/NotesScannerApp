import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, View, type KeyboardEvent, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

type KeyboardLiftProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function KeyboardLift({ children, style, testID }: KeyboardLiftProps) {
  const insets = useContext(SafeAreaInsetsContext);
  const ref = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const [lift, setLift] = useState(0);

  const measure = useCallback(() => {
    const top = keyboardTop.current;
    if (top === null) {
      setLift(0);
      return;
    }
    ref.current?.measureInWindow((_x, y, _width, height) => {
      if (keyboardTop.current !== top) {
        return;
      }
      setLift(Math.max(0, y + height - top));
    });
  }, []);

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const moved = (event: KeyboardEvent) => {
      keyboardTop.current = event.endCoordinates.screenY;
      measure();
    };
    const closed = () => {
      keyboardTop.current = null;
      measure();
    };
    const subscriptions = [
      Keyboard.addListener(ios ? "keyboardWillChangeFrame" : "keyboardDidShow", moved),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", closed),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [measure]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={[style, { paddingBottom: Math.max(lift, insets?.bottom ?? 0) }]} testID={testID}>
      {children}
    </View>
  );
}
