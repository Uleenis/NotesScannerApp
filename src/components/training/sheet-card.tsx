import { StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { colors, radius, typography } from "@/theme";
import { faultsOfSheet, sheetLines, type Sheet, type Template } from "@/training/writing-test";

type Props = { template: Template; sheet: Sheet };

export function SheetCard({ template, sheet }: Props) {
  const t = useStrings();
  const lines = sheetLines(template, sheet);
  const faults = faultsOfSheet(template, sheet).map((fault) => fault.line);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t.training.writing.sheetTitle(sheet)}</Text>
      <Text style={styles.range}>{t.training.writing.sheetRange(sheet, lines.length)}</Text>
      {lines.map((line, index) => (
        <View key={index} style={styles.line}>
          <Text style={styles.number}>{index + 1}</Text>
          <Text style={styles.text}>{line}</Text>
        </View>
      ))}
      {faults.length === 0 ? null : <Text style={styles.note}>{t.training.writing.faultsNote(faults.join(", "))}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.block,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  title: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontWeight: "600",
  },
  range: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingBottom: 8,
  },
  line: {
    flexDirection: "row",
    gap: 10,
  },
  number: {
    ...typography.footnote,
    color: colors.inkSecondary,
    minWidth: 22,
    paddingTop: 2,
    textAlign: "right",
  },
  text: {
    ...typography.interfaceBody,
    color: colors.ink,
    flex: 1,
  },
  note: {
    ...typography.footnote,
    color: colors.inkSecondary,
    paddingTop: 8,
  },
});
