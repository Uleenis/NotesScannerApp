import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { BackLink } from "@/components/back-link";
import { LargeTitle } from "@/components/large-title";
import { LoadError } from "@/components/load-error";
import { MenuButton } from "@/components/menu-button";
import { NotebookRow } from "@/components/notebook-row";
import { PageRow } from "@/components/reading/page-row";
import { ScanButton } from "@/components/scan-button";
import { planNotebook } from "@/export/document";
import { useExportItem } from "@/export/use-export";
import { useStrings } from "@/i18n";
import { confirmDeletion, showMenu } from "@/lib/action-menu";
import { useChapters, useDeleteNotebook, useNotebook } from "@/notebooks/queries";
import type { DeleteResult } from "@/notebooks/removal";
import { usePages } from "@/pages/queries";
import { colors, typography } from "@/theme";

export default function NotebookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const notebook = useNotebook(id);
  const pages = usePages();
  const chapters = useChapters();
  const deletion = useDeleteNotebook();
  const exportItem = useExportItem();

  if (notebook.data === null) {
    return <Redirect href="/" />;
  }
  if (notebook.data === undefined) {
    return notebook.isError ? (
      <LoadError message={t.library.loadFailed} onRetry={() => notebook.refetch()} />
    ) : null;
  }

  if (chapters.data === undefined) {
    return chapters.isError ? <LoadError message={t.library.loadFailed} onRetry={() => chapters.refetch()} /> : null;
  }

  const pageCount = notebook.data.pageCount;
  const notebookName = notebook.data.name;
  const notebookChapters = chapters.data.filter((chapter) => chapter.notebookId === id);
  const hasChapters = notebookChapters.length > 0;
  const outsideChapters = (pages.data ?? [])
    .filter((page) => page.notebookId === id && page.chapterId === null)
    .sort((a, b) => b.number - a.number);

  async function remove() {
    const result = await deletion.mutateAsync(id).catch((): DeleteResult => ({ status: "error" }));
    if (result.status === "deleted" || result.status === "missing") {
      router.dismissTo("/");
    } else {
      Alert.alert(result.status === "busy" ? t.notebook.deleteBusy : t.notebook.deleteFailed);
    }
  }

  function openMenu() {
    showMenu(
      [
        { label: t.search.open, onPress: () => router.push({ pathname: "/search", params: { notebook: id } }) },
        exportItem(
          planNotebook(
            notebookName,
            notebookChapters,
            (pages.data ?? []).filter((page) => page.notebookId === id),
            t.notebook.pagesHeading,
          ),
        ),
        { label: t.notebook.newChapter, onPress: () => router.push({ pathname: "/new-chapter", params: { notebook: id } }) },
        { label: t.notebook.rename, onPress: () => router.push({ pathname: "/rename", params: { kind: "notebook", id } }) },
        {
          label: t.notebook.delete,
          destructive: true,
          onPress: () =>
            confirmDeletion(
              t.notebook.deleteTitle(pageCount),
              t.notebook.deleteBody,
              { cancel: t.common.cancel, confirm: t.notebook.delete },
              () => void remove(),
            ),
        },
      ],
      t.common.cancel,
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "",
          headerBackVisible: false,
          headerLeft: () => <BackLink name={t.library.title} label={t.library.title} onPress={() => router.dismissTo("/")} />,
          headerRight: () => <MenuButton label={t.notebook.menuLabel} onPress={openMenu} />,
        }}
      />
      <LargeTitle text={notebook.data.name} />
      <View style={styles.container}>
        <Text style={styles.count}>{t.notebook.pageCount(pageCount)}</Text>
        {pageCount === 0 && !hasChapters ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t.notebook.emptyTitle}</Text>
            <Text style={styles.emptyBody}>{t.notebook.emptyBody}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {hasChapters ? (
              <>
                <Text style={styles.section}>{t.notebook.chaptersHeading}</Text>
                {notebookChapters.map((chapter) => (
                  <NotebookRow
                    key={chapter.id}
                    notebook={chapter}
                    detail={t.notebook.pageCount(chapter.pageCount)}
                    onPress={() => router.push(`/chapter/${chapter.id}`)}
                  />
                ))}
                {outsideChapters.length > 0 ? <Text style={styles.section}>{t.notebook.pagesHeading}</Text> : null}
              </>
            ) : null}
            {pages.data === undefined
              ? pages.isError
                ? <LoadError message={t.notebook.pagesLoadFailed} onRetry={() => pages.refetch()} />
                : null
              : outsideChapters.map((page) => <PageRow key={page.id} page={page} onPress={() => router.push(`/page/${page.id}`)} />)}
          </ScrollView>
        )}
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
  section: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingBottom: 8,
    paddingTop: 16,
  },
  list: {
    paddingBottom: 140,
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
