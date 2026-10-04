import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { AccountButton } from "@/components/account-button";
import { FirstLaunch } from "@/components/first-launch";
import { LoadError } from "@/components/load-error";
import { NotebookRow } from "@/components/notebook-row";
import { ScanButton } from "@/components/scan-button";
import { useStrings } from "@/i18n";
import { useNotebooks } from "@/notebooks/queries";
import { colors, typography } from "@/theme";

function openNewNotebook() {
  router.push("/new-notebook");
}

function LibraryBody() {
  const t = useStrings();
  const notebooks = useNotebooks();

  if (notebooks.data === undefined) {
    return notebooks.isError ? (
      <LoadError message={t.library.loadFailed} onRetry={() => notebooks.refetch()} />
    ) : null;
  }
  if (notebooks.data.length === 0) {
    return <FirstLaunch onCreate={openNewNotebook} />;
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Text style={styles.section}>{t.library.notebooks}</Text>
        {notebooks.data.map((notebook) => (
          <NotebookRow
            key={notebook.id}
            notebook={notebook}
            onPress={() => router.push(`/notebook/${notebook.id}`)}
          />
        ))}
        <Pressable accessibilityRole="button" onPress={openNewNotebook} style={styles.newNotebook}>
          <Ionicons name="add" size={24} color={colors.ink} />
          <Text style={styles.newNotebookLabel}>{t.library.newNotebook}</Text>
        </Pressable>
      </ScrollView>
      <ScanButton />
    </>
  );
}

export default function LibraryScreen() {
  const t = useStrings();

  return (
    <>
      <Stack.Screen
        options={{
          title: t.library.title,
          headerLargeTitleEnabled: true,
          headerRight: () => <AccountButton />,
        }}
      />
      <LibraryBody />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 140,
    paddingHorizontal: 20,
  },
  section: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingBottom: 8,
    paddingTop: 16,
  },
  newNotebook: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingVertical: 16,
  },
  newNotebookLabel: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
});
