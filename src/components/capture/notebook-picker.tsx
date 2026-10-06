import { Pressable, StyleSheet, Text, View } from "react-native";

import type { NotebookSummary } from "@/notebooks/notebooks";
import { colors, radius, typography } from "@/theme";

type Props = {
  notebooks: NotebookSummary[];
  selectedId: string;
  onPick: (id: string) => void;
};

export function NotebookPicker({ notebooks, selectedId, onPick }: Props) {
  return (
    <View style={styles.list}>
      {notebooks.map((notebook) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: notebook.id === selectedId }}
          key={notebook.id}
          onPress={() => onPick(notebook.id)}
          style={styles.row}
        >
          <Text numberOfLines={1} style={notebook.id === selectedId ? styles.selected : styles.name}>
            {notebook.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    alignSelf: "center",
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.block,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 280,
    minWidth: 200,
    paddingVertical: 4,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  name: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
  selected: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontWeight: "600",
  },
});
