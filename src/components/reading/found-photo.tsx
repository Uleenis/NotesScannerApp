import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { useStrings } from "@/i18n";
import { frameOf, type PhotoSize } from "@/pages/frame";
import { usePhotoUrl } from "@/pages/queries";
import { useAnchor } from "@/search/queries";
import { colors } from "@/theme";
import { FrameOverlay } from "./frame-overlay";
import { displayedSize } from "./zoomable-photo";

const MAX_HEIGHT = 320;

type Props = { pageId: string; tokenIndex: number };

export function FoundPhoto({ pageId, tokenIndex }: Props) {
  const t = useStrings();
  const anchor = useAnchor(pageId, tokenIndex);
  const photo = usePhotoUrl(pageId);
  const [size, setSize] = useState<PhotoSize | null>(null);
  const [width, setWidth] = useState(0);

  const uri = photo.data;
  const box = anchor.data?.box ?? null;
  if (uri === undefined || box === null) {
    return null;
  }
  const frame = size === null ? null : frameOf(box, size);
  if (size !== null && frame === null) {
    return null;
  }
  if (size === null || frame === null) {
    return (
      <Image
        testID="found-photo-image"
        source={{ uri }}
        resizeMethod="scale"
        onLoad={(event) => setSize({ width: event.nativeEvent.source.width, height: event.nativeEvent.source.height })}
        style={styles.probe}
      />
    );
  }

  const shown = displayedSize(size, { width, height: MAX_HEIGHT });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.document.openPhoto}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onPress={() => router.push({ pathname: "/page/[id]/photo", params: { id: pageId, found: String(tokenIndex) } })}
      style={styles.area}
      testID="found-photo"
    >
      {width > 0 ? (
        <View style={{ height: shown.height, width: shown.width }}>
          <Image testID="found-photo-shown" source={{ uri }} resizeMode="contain" style={styles.shown} />
          <FrameOverlay frame={frame} label={t.search.frameLabel} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  probe: {
    height: 1,
    opacity: 0,
    position: "absolute",
    width: 1,
  },
  area: {
    alignItems: "center",
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  shown: {
    height: "100%",
    width: "100%",
  },
});
