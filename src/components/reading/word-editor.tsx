import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useStrings } from "@/i18n";
import { isWord, type ChosenFrom, type PlacedWord } from "@/pages/words";
import { colors, radius, typography } from "@/theme";

export type WordEditorProps = {
  word: PlacedWord;
  saving: boolean;
  failed: boolean;
  onSubmit: (text: string, chosenFrom: ChosenFrom) => void;
  onCancel: () => void;
};

export function WordEditor({ word, saving, failed, onSubmit, onCancel }: WordEditorProps) {
  const t = useStrings();
  const [value, setValue] = useState(word.shown);
  const valid = isWord(value);

  function submit() {
    if (valid && !saving) {
      onSubmit(value, "keyboard");
    }
  }

  return (
    <View style={styles.bar}>
      {word.suggestions.length > 0 ? (
        <ScrollView
          accessibilityLabel={t.document.wordSuggestions}
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestions}
        >
          {word.suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.text}
              accessibilityRole="button"
              disabled={saving}
              onPress={() => onSubmit(suggestion.text, suggestion.source)}
              style={styles.suggestion}
            >
              <Text style={styles.suggestionText}>{suggestion.text}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" disabled={saving} hitSlop={8} onPress={onCancel} style={styles.action}>
          <Text style={styles.actionText}>{t.common.cancel}</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={t.document.wordField}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          editable={!saving}
          onChangeText={setValue}
          onSubmitEditing={submit}
          returnKeyType="done"
          selectTextOnFocus
          style={styles.input}
          value={value}
        />
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !valid || saving }} disabled={!valid || saving} hitSlop={8} onPress={submit} style={styles.action}>
          <Text style={[styles.actionText, styles.done, !valid || saving ? styles.disabled : null]}>{t.common.done}</Text>
        </Pressable>
      </View>
      {!valid ? <Text style={styles.problem}>{t.document.wordInvalid}</Text> : null}
      {failed ? <Text style={styles.problem}>{t.document.wordSaveFailed}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.sheet,
    borderTopColor: colors.rule,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  suggestions: {
    gap: 8,
    paddingBottom: 8,
  },
  suggestion: {
    backgroundColor: colors.blueTint,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionText: {
    ...typography.interfaceBody,
    color: colors.blue,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  input: {
    ...typography.interfaceBody,
    backgroundColor: colors.paper,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.ink,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  action: {
    justifyContent: "center",
    minHeight: 44,
  },
  actionText: {
    ...typography.interfaceBody,
    color: colors.blue,
  },
  done: {
    fontWeight: "600",
  },
  disabled: {
    color: colors.inkTertiary,
  },
  problem: {
    ...typography.footnote,
    color: colors.danger,
    paddingTop: 6,
  },
});
