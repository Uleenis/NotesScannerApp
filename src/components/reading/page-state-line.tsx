import { StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import type { PageRecord } from "@/pages/pages";
import { readingView } from "@/pages/reading-state";
import { colors, typography } from "@/theme";
import { InkStroke } from "./ink-stroke";

const STROKE_WIDTH = 40;

export function PageStateLine({ page }: { page: Pick<PageRecord, "status" | "queueReason" | "attemptedAt"> }) {
  const t = useStrings();
  const view = readingView(page, new Date());

  switch (view.kind) {
    case "waiting":
      return (
        <View style={styles.line}>
          <InkStroke tone="blue" animated width={STROKE_WIDTH} />
          <Text style={styles.label}>{t.document.stateInProgress}</Text>
        </View>
      );
    case "deferred":
      return <Text style={styles.label}>{t.document.stateDeferred(view.minutes)}</Text>;
    case "failed":
      return <Text style={styles.label}>{t.document.stateFailed}</Text>;
    case "document":
      return null;
  }
}

const styles = StyleSheet.create({
  line: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  label: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
});
