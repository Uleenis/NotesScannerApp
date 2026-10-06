import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { LoadError } from "@/components/load-error";
import { ScanButton } from "@/components/scan-button";
import { useStrings } from "@/i18n";
import { useNotebook } from "@/notebooks/queries";
import { colors, typography } from "@/theme";

export default function NotebookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const notebook = useNotebook(id);

  if (notebook.data === null) {
    return <Redirect href="/" />;
  }
  if (notebook.data === undefined) {
    return notebook.isError ? (
      <LoadError message={t.library.loadFailed} onRetry={() => notebook.refetch()} />
    ) : null;
  }

  return (
    <>
      <Stack.Screen options={{ title: notebook.data.name, headerLargeTitleEnabled: true }} />
      <View style={styles.container}>
        <Text style={styles.count}>{t.notebook.pageCount(notebook.data.pageCount)}</Text>
        {notebook.data.pageCount === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t.notebook.emptyTitle}</Text>
            <Text style={styles.emptyBody}>{t.notebook.emptyBody}</Text>
          </View>
        ) : null}
      </View>
      <ScanButton notebookId={id} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  count: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    paddingBottom: 80,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    ...typography.pageTitle,
    color: colors.ink,
    textAlign: "center",
  },
  emptyBody: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    textAlign: "center",
  },
});
