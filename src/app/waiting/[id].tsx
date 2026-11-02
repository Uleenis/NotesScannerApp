import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { chooseWaitingNotebook, discardWaiting, sendWaitingNow } from "@/capture/queue-service";
import { NotebookPicker } from "@/components/capture/notebook-picker";
import { PrimaryButton } from "@/components/primary-button";
import { SecondaryButton } from "@/components/secondary-button";
import { useStrings } from "@/i18n";
import { confirmDeletion } from "@/lib/action-menu";
import { useNotebooks } from "@/notebooks/queries";
import { openLocalQueuedPhoto } from "@/offline/local-photo";
import { useWaitingPages } from "@/offline/use-waiting";
import { colors, typography } from "@/theme";

export default function WaitingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const list = useWaitingPages();
  const notebooks = useNotebooks();
  const entry = list?.find((candidate) => candidate.id === id);
  const found = entry !== undefined;
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!found) {
      return;
    }
    let live = true;
    let release: (() => void) | null = null;
    openLocalQueuedPhoto(id)
      .then((opened) => {
        if (live) {
          release = opened.release;
          setPhoto(opened.uri);
        } else {
          opened.release();
        }
      })
      .catch(() => {
        if (live) {
          setPhotoFailed(true);
        }
      });
    return () => {
      live = false;
      release?.();
    };
  }, [id, found]);

  if (leaving || list === null) {
    return null;
  }
  if (entry === undefined) {
    return <Redirect href="/" />;
  }

  function askDeletion() {
    confirmDeletion(t.waiting.deleteTitle, t.waiting.deleteBody, { cancel: t.common.cancel, confirm: t.waiting.delete }, () => {
      setLeaving(true);
      void discardWaiting(id).then(() => router.back());
    });
  }

  async function pick(notebookId: string) {
    setChoosing(false);
    if (await chooseWaitingNotebook(id, notebookId)) {
      void sendWaitingNow();
    }
  }

  const lostNotebook = entry.blocked === "notebook";

  return (
    <>
      <Stack.Screen options={{ title: t.waiting.title }} />
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.frame}>
            {photo === null ? null : <Image source={{ uri: photo }} resizeMode="contain" accessibilityLabel={t.photo.label} style={styles.photo} />}
          </View>
          {photoFailed ? <Text style={styles.body}>{t.waiting.unavailable}</Text> : null}
          <Text accessibilityRole="header" style={styles.title}>
            {entry.blocked === null ? t.waiting.state : t.waiting.blocked[entry.blocked]}
          </Text>
          <Text style={styles.body}>{lostNotebook ? t.waiting.notebookGone : t.waiting.body}</Text>
          {choosing ? <NotebookPicker notebooks={notebooks.data ?? []} selectedId="" onPick={(notebookId) => void pick(notebookId)} /> : null}
        </ScrollView>
        <View style={[styles.buttons, { paddingBottom: insets.bottom + 16 }]}>
          {lostNotebook ? <PrimaryButton label={t.waiting.chooseNotebook} onPress={() => setChoosing((open) => !open)} /> : null}
          <SecondaryButton label={t.waiting.delete} onPress={askDeletion} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  frame: {
    aspectRatio: 3 / 4,
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 360,
    width: "100%",
  },
  photo: {
    flex: 1,
  },
  title: {
    ...typography.pageTitle,
    color: colors.ink,
    textAlign: "center",
  },
  body: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  buttons: {
    gap: 12,
    paddingHorizontal: 20,
  },
});
