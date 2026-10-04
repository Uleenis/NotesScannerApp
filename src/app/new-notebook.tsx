import { Stack, router } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { HeaderTextButton } from "@/components/header-text-button";
import { useStrings } from "@/i18n";
import { useCreateNotebook } from "@/notebooks/queries";
import { colors, radius, typography } from "@/theme";

type Problem = { kind: "duplicate"; name: string } | { kind: "failed" };

export default function NewNotebookScreen() {
  const t = useStrings();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const create = useCreateNotebook();
  const sending = useRef(false);

  async function submit() {
    if (sending.current || name.trim() === "") {
      return;
    }
    sending.current = true;
    try {
      const result = await create.mutateAsync(name);
      if (result.status === "created") {
        router.dismiss();
        router.push(`/notebook/${result.notebook.id}`);
      } else if (result.status === "duplicate") {
        setProblem({ kind: "duplicate", name: result.name });
      } else if (result.status === "failed") {
        setProblem({ kind: "failed" });
      }
    } catch {
      setProblem({ kind: "failed" });
    } finally {
      sending.current = false;
    }
  }

  function change(text: string) {
    setName(text);
    setProblem(null);
  }

  const message =
    problem === null
      ? t.newNotebook.hint
      : problem.kind === "duplicate"
        ? t.newNotebook.duplicate(problem.name)
        : t.newNotebook.failed;

  return (
    <>
      <Stack.Screen
        options={{
          title: t.newNotebook.title,
          contentStyle: { backgroundColor: colors.sheet },
          headerLeft: () => <HeaderTextButton label={t.common.cancel} onPress={() => router.back()} />,
          headerRight: () => <HeaderTextButton label={t.newNotebook.create} onPress={submit} />,
        }}
      />
      <View style={styles.container}>
        <TextInput
          accessibilityLabel={t.newNotebook.nameLabel}
          autoFocus
          maxLength={200}
          onChangeText={change}
          onSubmitEditing={submit}
          returnKeyType="done"
          style={[styles.field, problem !== null && styles.fieldWithProblem]}
          submitBehavior="submit"
          value={name}
        />
        <Text style={problem === null ? styles.hint : styles.problem}>{message}</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    padding: 16,
  },
  field: {
    ...typography.interfaceBody,
    backgroundColor: colors.paper,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldWithProblem: {
    borderColor: colors.ink,
    borderWidth: 1,
  },
  hint: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingHorizontal: 4,
  },
  problem: {
    ...typography.interfaceSecondary,
    color: colors.ink,
    paddingHorizontal: 4,
  },
});
