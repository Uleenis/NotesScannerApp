import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { cachedTex, releaseTex, renderTex, type DrawnTex } from "@/pages/tex";
import { colors, typography } from "@/theme";

const EX = typography.documentBody.fontSize * 0.5;
const MAX_INLINE_WIDTH_EX = 36;

type FormulaProps = { tex: string; source: string; display: boolean; raw: boolean };

function useDrawn(tex: string, display: boolean, raw: boolean): DrawnTex | null | undefined {
  const [drawn, setDrawn] = useState<{ key: string; value: DrawnTex | null } | null>(null);
  const key = `${display ? "display" : "inline"}:${tex}`;

  useEffect(() => {
    if (raw) {
      return;
    }
    let live = true;
    const ask = (): void => {
      void renderTex(tex, display).then((value) => {
        if (!live) {
          return;
        }
        if (value === undefined) {
          ask();
        } else {
          setDrawn({ key, value });
        }
      });
    };
    ask();
    return () => {
      live = false;
      releaseTex(tex, display);
    };
  }, [tex, display, key, raw]);

  if (raw) {
    return null;
  }
  return drawn !== null && drawn.key === key ? drawn.value : cachedTex(tex, display);
}

function Drawing({ drawn, source }: { drawn: DrawnTex; source: string }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={source} testID="formula">
      <SvgXml xml={drawn.svg} width={drawn.width * EX} height={drawn.height * EX} color={colors.ink} />
    </View>
  );
}

export function Formula({ tex, source, display, raw }: FormulaProps) {
  const drawn = useDrawn(tex, display, raw);

  if (display) {
    if (drawn === undefined) {
      return <View style={styles.pending} />;
    }
    if (drawn === null) {
      return (
        <Text selectable style={styles.raw}>
          {source}
        </Text>
      );
    }
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.display}>
        <Drawing drawn={drawn} source={source} />
      </ScrollView>
    );
  }
  if (drawn === undefined) {
    return null;
  }
  if (drawn === null || drawn.width > MAX_INLINE_WIDTH_EX) {
    return <Text style={styles.inlineRaw}>{source}</Text>;
  }
  return (
    <View style={{ transform: [{ translateY: -drawn.shift * EX }] }}>
      <Drawing drawn={drawn} source={source} />
    </View>
  );
}

const styles = StyleSheet.create({
  display: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: typography.documentBody.lineHeight * 0.4,
  },
  pending: {
    height: typography.documentBody.lineHeight * 1.8,
  },
  raw: {
    ...typography.documentBody,
    color: colors.ink,
    paddingBottom: typography.documentBody.lineHeight * 0.4,
  },
  inlineRaw: {
    color: colors.ink,
  },
});
