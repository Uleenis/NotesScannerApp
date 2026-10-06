import { Image, Pressable, StyleSheet } from "react-native";

import { useStrings } from "@/i18n";
import { colors, radius } from "@/theme";

type Props = { photoUrl: string | undefined; open: boolean; onPress: () => void };

export function PageThumbnail({ photoUrl, open, onPress }: Props) {
  const t = useStrings();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.document.openPhoto}
      onPress={onPress}
      style={[styles.frame, open && styles.open]}
    >
      {photoUrl === undefined ? null : <Image source={{ uri: photoUrl }} resizeMode="cover" style={styles.photo} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    overflow: "hidden",
    width: 44,
  },
  open: {
    borderColor: colors.ink,
    borderWidth: 2,
  },
  photo: {
    height: "100%",
    width: "100%",
  },
});
