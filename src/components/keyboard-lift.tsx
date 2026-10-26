import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Dimensions, Keyboard, Platform, View, type KeyboardEvent, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

type KeyboardLiftProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function KeyboardLift({ children, style, testID }: KeyboardLiftProps) {
  const insets = useContext(SafeAreaInsetsContext);
  const bottomInset = insets?.bottom ?? 0;
  const ref = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const keyboardHeight = useRef(0);
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
      const measured = Math.max(0, y + height - top);
      if (Platform.OS !== "android") {
        setLift(measured);
        return;
      }
      const below = Math.max(0, Dimensions.get("window").height - (y + height));
      setLift(Math.max(measured, keyboardHeight.current + bottomInset - below));
    });
  }, [bottomInset]);

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const moved = (event: KeyboardEvent) => {
      keyboardTop.current = event.endCoordinates.screenY;
      keyboardHeight.current = event.endCoordinates.height;
      measure();
    };
    const closed = () => {
      keyboardTop.current = null;
      keyboardHeight.current = 0;
      measure();
    };
    const subscriptions = [
      Keyboard.addListener(ios ? "keyboardWillChangeFrame" : "keyboardDidShow", moved),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", closed),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [measure]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={[style, { paddingBottom: Math.max(lift, bottomInset) }]} testID={testID}>
      {children}
    </View>
  );
}
