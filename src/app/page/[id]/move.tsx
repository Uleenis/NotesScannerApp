import { Ionicons } from "@expo/vector-icons";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { LoadError } from "@/components/load-error";
import { useStrings } from "@/i18n";
import { useChapters, useNotebooks } from "@/notebooks/queries";
import type { MoveResult } from "@/pages/pages";
import { useMovePage, usePage } from "@/pages/queries";
import { colors, typography } from "@/theme";

type Destination = { notebookId: string; chapterId: string | null };

export default function MovePageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const page = usePage(id);
  const notebooks = useNotebooks();
  const chapters = useChapters();
  const move = useMovePage(id);
  const sending = useRef(false);
  const [problem, setProblem] = useState<"busy" | "failed" | null>(null);

  if (page.data === null) {
    return <Redirect href="/" />;
  }
  if (page.data === undefined || notebooks.data === undefined || chapters.data === undefined) {
    return page.isError || notebooks.isError || chapters.isError ? (
      <LoadError message={t.library.loadFailed} onRetry={() => void Promise.all([page.refetch(), notebooks.refetch(), chapters.refetch()])} />
    ) : null;
  }

  const current: Destination = { notebookId: page.data.notebookId, chapterId: page.data.chapterId };

  async function choose(destination: Destination) {
    if (sending.current) {
      return;
    }
    if (destination.notebookId === current.notebookId && destination.chapterId === current.chapterId) {
      router.dismiss();
      return;
    }
    sending.current = true;
    setProblem(null);
    try {
      const result = await move.mutateAsync(destination).catch((): MoveResult => ({ status: "error" }));
      if (result.status === "moved") {
        router.dismiss();
      } else {
        setProblem(result.status === "busy" ? "busy" : "failed");
      }
    } finally {
      sending.current = false;
    }
  }

  function row(label: string, destination: Destination, indented: boolean) {
    const selected = destination.notebookId === current.notebookId && destination.chapterId === current.chapterId;
    return (
      <Pressable
        key={destination.chapterId ?? destination.notebookId}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => void choose(destination)}
        style={[styles.row, indented && styles.indented]}
      >
        <Text style={[styles.name, !indented && styles.notebookName]}>{label}</Text>
        {selected ? <Ionicons name="checkmark" size={20} color={colors.ink} /> : null}
      </Pressable>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t.move.title}</Text>
      <Text style={styles.hint}>{t.move.hint}</Text>
      {problem === null ? null : <Text style={styles.problem}>{problem === "busy" ? t.move.busy : t.move.failed}</Text>}
      <View>
        {notebooks.data.map((notebook) => (
          <View key={notebook.id}>
            {row(notebook.name, { notebookId: notebook.id, chapterId: null }, false)}
            {chapters.data
              .filter((chapter) => chapter.notebookId === notebook.id)
              .map((chapter) => row(chapter.name, { notebookId: notebook.id, chapterId: chapter.id }, true))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 8,
    paddingBottom: 40,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  title: {
    ...typography.pageTitle,
    color: colors.ink,
  },
  hint: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingBottom: 8,
  },
  problem: {
    ...typography.interfaceSecondary,
    color: colors.ink,
    paddingBottom: 8,
  },
  row: {
    alignItems: "center",
    borderBottomColor: colors.rule,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  indented: {
    paddingLeft: 24,
  },
  name: {
    ...typography.interfaceBody,
    color: colors.ink,
    flexShrink: 1,
  },
  notebookName: {
    fontWeight: "600",
  },
});
