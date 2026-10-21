import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { BackLink } from "@/components/back-link";
import { LargeTitle } from "@/components/large-title";
import { LoadError } from "@/components/load-error";
import { MenuButton } from "@/components/menu-button";
import { PageRow } from "@/components/reading/page-row";
import { ScanButton } from "@/components/scan-button";
import { useStrings } from "@/i18n";
import { confirmDeletion, showMenu } from "@/lib/action-menu";
import { useChapters, useDeleteChapter, useNotebook } from "@/notebooks/queries";
import type { DeleteResult } from "@/notebooks/removal";
import { usePages } from "@/pages/queries";
import { colors, typography } from "@/theme";

export default function ChapterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const chapters = useChapters();
  const pages = usePages();
  const chapter = chapters.data?.find((candidate) => candidate.id === id);
  const notebook = useNotebook(chapter?.notebookId ?? null);
  const deletion = useDeleteChapter();

  if (chapters.data === undefined) {
    return chapters.isError ? <LoadError message={t.chapter.loadFailed} onRetry={() => chapters.refetch()} /> : null;
  }
  if (chapter === undefined) {
    return <Redirect href="/" />;
  }

  const notebookId = chapter.notebookId;
  const chapterPages = (pages.data ?? []).filter((page) => page.chapterId === id).sort((a, b) => b.number - a.number);

  function backToNotebook() {
    router.dismissTo(`/notebook/${notebookId}`);
  }

  async function remove() {
    const result = await deletion.mutateAsync(id).catch((): DeleteResult => ({ status: "error" }));
    if (result.status === "deleted" || result.status === "missing") {
      backToNotebook();
    } else {
      Alert.alert(t.chapter.deleteFailed);
    }
  }

  function openMenu() {
    showMenu(
      [
        { label: t.chapter.rename, onPress: () => router.push({ pathname: "/rename", params: { kind: "chapter", id } }) },
        {
          label: t.chapter.delete,
          destructive: true,
          onPress: () =>
            confirmDeletion(t.chapter.deleteTitle, t.chapter.deleteBody, { cancel: t.common.cancel, confirm: t.chapter.delete }, () => void remove()),
        },
      ],
      t.common.cancel,
    );
  }

  const notebookName = notebook.data?.name ?? "";

  return (
    <>
      <Stack.Screen
        options={{
          title: "",
          headerBackVisible: false,
          headerLeft: () => <BackLink name={notebookName} label={t.common.back} onPress={backToNotebook} />,
          headerRight: () => <MenuButton label={t.chapter.menuLabel} onPress={openMenu} />,
        }}
      />
      <LargeTitle text={chapter.name} />
      <View style={styles.container}>
        <Text style={styles.count}>{t.notebook.pageCount(chapter.pageCount)}</Text>
        {chapter.pageCount === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t.chapter.emptyTitle}</Text>
            <Text style={styles.emptyBody}>{t.chapter.emptyBody}</Text>
          </View>
        ) : pages.data === undefined ? (
          pages.isError ? (
            <LoadError message={t.notebook.pagesLoadFailed} onRetry={() => pages.refetch()} />
          ) : null
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {chapterPages.map((page) => (
              <PageRow key={page.id} page={page} onPress={() => router.push(`/page/${page.id}`)} />
            ))}
          </ScrollView>
        )}
      </View>
      <ScanButton notebookId={notebookId} chapterId={id} />
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
