import { usePathname } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { closeMenu, currentMenu, subscribeToMenu, type MenuItem } from "@/lib/action-menu";
import { colors, radius, typography } from "@/theme";

export function ActionSheetHost() {
  const menu = useSyncExternalStore(subscribeToMenu, currentMenu, currentMenu);
  const insets = useSafeAreaInsets();
  const open = menu !== null;
  const pathname = usePathname();

  useEffect(() => closeMenu(), [pathname]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeMenu();
      return true;
    });
    return () => subscription.remove();
  }, [open]);

  if (menu === null) {
    return null;
  }

  function choose(item: MenuItem) {
    closeMenu();
    item.onPress();
  }

  return (
    <View accessibilityViewIsModal style={styles.overlay}>
      <Pressable accessible={false} importantForAccessibility="no" testID="action-sheet-backdrop" onPress={closeMenu} style={styles.backdrop} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.group}>
          {menu.items.map((item, index) => (
            <Pressable
              key={`${index}-${item.label}`}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              testID={`action-sheet-option-${index}`}
              onPress={() => choose(item)}
              style={[styles.option, index > 0 && styles.separated]}
            >
              <Text testID={`action-sheet-label-${index}`} style={[styles.label, item.destructive === true && styles.destructive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={menu.cancelLabel} onPress={closeMenu} style={[styles.group, styles.option]}>
          <Text style={[styles.label, styles.cancel]}>{menu.cancelLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    elevation: 24,
    justifyContent: "flex-end",
    zIndex: 1000,
  },
  backdrop: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    backgroundColor: colors.scrim,
  },
  sheet: {
    gap: 8,
    paddingHorizontal: 12,
  },
  group: {
    backgroundColor: colors.sheet,
    borderRadius: radius.block,
    overflow: "hidden",
  },
  option: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 16,
  },
  separated: {
    borderTopColor: colors.rule,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: {
    ...typography.interfaceBody,
    color: colors.blue,
  },
  destructive: {
    color: colors.danger,
  },
  cancel: {
    fontWeight: "600",
  },
});
