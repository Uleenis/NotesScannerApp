import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { AccountButton } from "@/components/account-button";
import { FirstLaunch } from "@/components/first-launch";
import { LargeTitle } from "@/components/large-title";
import { LoadError } from "@/components/load-error";
import { NotebookRow } from "@/components/notebook-row";
import { LatestPageCard } from "@/components/reading/latest-page-card";
import { ScanButton } from "@/components/scan-button";
import { useAllowance } from "@/capture/queries";
import { useStrings } from "@/i18n";
import { useNotebooks } from "@/notebooks/queries";
import { dateParts } from "@/pages/dates";
import { newestFirst } from "@/pages/pages";
import { usePages } from "@/pages/queries";
import { colors, typography } from "@/theme";

const LATEST_PAGES = 10;

function openNewNotebook() {
  router.push("/new-notebook");
}

function LibraryBody() {
  const t = useStrings();
  const notebooks = useNotebooks();
  const pages = usePages();
  const allowance = useAllowance();

  if (notebooks.data === undefined) {
    return notebooks.isError ? (
      <LoadError message={t.library.loadFailed} onRetry={() => notebooks.refetch()} />
    ) : null;
  }
  if (notebooks.data.length === 0) {
    return <FirstLaunch onCreate={openNewNotebook} />;
  }

  const known = pages.data ?? [];
  const latest = newestFirst(known).slice(0, LATEST_PAGES);
  const notebookNames = new Map(notebooks.data.map((notebook) => [notebook.id, notebook.name]));
  const showReminder = allowance.data?.isAnonymous === true && known.length > 0;

  function detail(notebook: { id: string; pageCount: number }): string {
    const count = t.notebook.pageCount(notebook.pageCount);
    const last = newestFirst(known).find((page) => page.notebookId === notebook.id);
    const parts = last === undefined ? null : dateParts(last.capturedAt, new Date());
    return parts === null ? count : t.notebook.pageCountAndDate(count, t.dates.short(parts.day, parts.month, parts.year));
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {showReminder ? <Text style={styles.reminder}>{t.library.anonymousReminder}</Text> : null}
        {latest.length === 0 ? null : (
          <>
            <Text style={styles.section}>{t.library.latestPages}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} style={styles.cardsScroll}>
              {latest.map((page) => (
                <LatestPageCard
                  key={page.id}
                  page={page}
                  notebookName={notebookNames.get(page.notebookId) ?? ""}
                  onPress={() => router.push(`/page/${page.id}`)}
                />
              ))}
            </ScrollView>
          </>
        )}
        <Text style={styles.section}>{t.library.notebooks}</Text>
        {notebooks.data.map((notebook) => (
          <NotebookRow
            key={notebook.id}
            notebook={notebook}
            detail={detail(notebook)}
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
          title: "",
          headerRight: () => <AccountButton />,
        }}
      />
      <LargeTitle text={t.library.title} />
      <LibraryBody />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 140,
    paddingHorizontal: 20,
  },
  reminder: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingTop: 4,
  },
  cardsScroll: {
    marginHorizontal: -20,
  },
  cards: {
    gap: 12,
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
