import { useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { useAuth } from "@/auth/auth-provider";
import { blockForReason } from "@/capture/allowance";
import { limitParams } from "@/capture/limit-route";
import { freshAllowance } from "@/capture/queries";
import { useOpenCapture } from "@/capture/use-open-capture";
import { BackLink } from "@/components/back-link";
import { DocumentView } from "@/components/reading/document-view";
import { PageThumbnail } from "@/components/reading/page-thumbnail";
import { WaitingView, type ViewAction } from "@/components/reading/waiting-view";
import { LoadError } from "@/components/load-error";
import { MenuButton } from "@/components/menu-button";
import { useStrings } from "@/i18n";
import { confirmDeletion, showMenu } from "@/lib/action-menu";
import { useNotebook } from "@/notebooks/queries";
import type { DeleteResult } from "@/notebooks/removal";
import type { NumberedPage, StartResult } from "@/pages/pages";
import { useDeletePage, usePage, usePhotoUrl, useStartReading } from "@/pages/queries";
import { fadeDelay, readingView, startReadingDelay, type ReadingView } from "@/pages/reading-state";
import { FADE_MS } from "@/pages/timing";
import { colors } from "@/theme";

type Problem = "held" | "unreadable";

type Notice = "tooSoon" | "failed";

type Phase = "reading" | "fading" | "document";

function currentTime(): number {
  return Date.now();
}

type LoadedPageProps = {
  page: NumberedPage;
  notebookName: string;
  now: Date;
  refetchPage: () => Promise<NumberedPage | null>;
};

function LoadedPage({ page, notebookName, now, refetchPage }: LoadedPageProps) {
  const t = useStrings();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const openCapture = useOpenCapture(page.notebookId, page.chapterId);
  const deletion = useDeletePage(page.id);
  const photo = usePhotoUrl(page.id);
  const start = useStartReading();
  const focused = useIsFocused();

  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [phase, setPhase] = useState<Phase>(page.status === "read" ? "document" : "reading");

  const relaunching = start.isPending;
  const view = readingView(page, now);
  const shownKind: ReadingView["kind"] = relaunching ? "waiting" : view.kind;

  const lastKind = useRef<ReadingView["kind"]>("waiting");
  const strokeStart = useRef<number | null>(null);
  const started = useRef(false);
  const focusedNow = useRef(focused);

  useEffect(() => {
    focusedNow.current = focused;
    return () => {
      focusedNow.current = false;
    };
  }, [focused]);

  useEffect(() => {
    if (shownKind !== "document") {
      lastKind.current = shownKind;
    }
    if (shownKind === "waiting" || strokeStart.current === null) {
      strokeStart.current = currentTime();
    }
  }, [shownKind]);

  useEffect(() => {
    if (phase !== "reading" || page.status !== "read") {
      return;
    }
    const wait = lastKind.current === "waiting" ? fadeDelay(currentTime() - (strokeStart.current ?? currentTime())) : 0;
    const timer = setTimeout(() => setPhase("fading"), wait);
    return () => clearTimeout(timer);
  }, [phase, page.status]);

  useEffect(() => {
    if (phase !== "fading") {
      return;
    }
    const timer = setTimeout(() => setPhase("document"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  async function begin(visible: boolean) {
    setNotice(null);
    setProblem(null);
    const result: StartResult = await start.mutateAsync(page.id).catch((): StartResult => ({ status: "error" }));
    switch (result.status) {
      case "limit": {
        const fresh = await freshAllowance(queryClient, userId);
        setProblem("held");
        if (focusedNow.current) {
          router.push({ pathname: "/limit", params: limitParams(blockForReason(result.reason, fresh)) });
        }
        break;
      }
      case "photo":
        setProblem("unreadable");
        break;
      case "tooSoon":
        setNotice("tooSoon");
        break;
      case "network":
      case "error":
        if (visible) {
          setNotice("failed");
        }
        break;
      default:
        break;
    }
  }

  const beginUnseen = useEffectEvent(async () => {
    if (!focusedNow.current) {
      return;
    }
    const fresh = await refetchPage();
    if (!focusedNow.current || fresh === null || startReadingDelay(fresh, new Date(currentTime())) !== 0) {
      return;
    }
    started.current = true;
    void begin(false);
  });

  useEffect(() => {
    if (started.current) {
      return;
    }
    const delay = startReadingDelay({ status: page.status, queueReason: page.queueReason, uploadedAt: page.uploadedAt }, new Date(currentTime()));
    if (delay === null) {
      return;
    }
    const timer = setTimeout(() => void beginUnseen(), delay);
    return () => clearTimeout(timer);
  }, [page.status, page.queueReason, page.uploadedAt, focused]);

  function backToNotebook() {
    router.dismissTo(`/notebook/${page.notebookId}`);
  }

  async function remove() {
    const result = await deletion.mutateAsync().catch((): DeleteResult => ({ status: "error" }));
    if (result.status === "deleted" || result.status === "missing") {
      backToNotebook();
    } else {
      Alert.alert(result.status === "busy" ? t.pageMenu.deleteBusy : t.pageMenu.deleteFailed);
    }
  }

  function openMenu() {
    showMenu(
      [
        { label: t.pageMenu.move, onPress: () => router.push({ pathname: "/page/[id]/move", params: { id: page.id } }) },
        {
          label: t.pageMenu.delete,
          destructive: true,
          onPress: () =>
            confirmDeletion(t.pageMenu.deleteTitle, t.pageMenu.deleteBody, { cancel: t.common.cancel, confirm: t.pageMenu.delete }, () => void remove()),
        },
      ],
      t.common.cancel,
    );
  }

  function openPhoto() {
    router.push({ pathname: "/page/[id]/photo", params: { id: page.id } });
  }

  const back: ViewAction = { label: t.reading.backTo(notebookName), onPress: backToNotebook };
  const scanNext: ViewAction = { label: t.reading.scanNext, onPress: () => void openCapture() };
  const relaunch: ViewAction = { label: t.reading.relaunch, onPress: () => void begin(true) };

  function reading() {
    const common = { pageNumber: page.number, photoUrl: photo.data };
    if (problem !== null && !relaunching && (view.kind === "waiting" || view.kind === "failed")) {
      return problem === "held" ? (
        <WaitingView {...common} stroke="still" title={t.reading.heldTitle} body={t.reading.heldBody} primary={back} secondary={scanNext} />
      ) : (
        <WaitingView {...common} stroke="still" title={t.reading.unreadableTitle} body={t.reading.unreadableBody} primary={back} secondary={scanNext} />
      );
    }
    if (shownKind === "deferred" && view.kind === "deferred") {
      return (
        <WaitingView {...common} stroke="still" title={t.reading.deferredTitle} body={t.reading.deferredBody(view.minutes)} primary={back} secondary={scanNext} />
      );
    }
    if (shownKind === "failed") {
      const message = notice === "tooSoon" ? t.reading.relaunchTooSoon : notice === "failed" ? t.reading.relaunchFailed : null;
      return (
        <WaitingView
          {...common}
          stroke="still"
          title={t.reading.failedTitle}
          body={t.reading.failedBody}
          notice={message}
          primary={relaunch}
          secondary={back}
        />
      );
    }
    return (
      <WaitingView {...common} stroke="writing" title={t.reading.waitingTitle} body={t.reading.waitingBody(notebookName)} secondary={scanNext} />
    );
  }

  const inDocument = phase === "document";

  return (
    <>
      <Stack.Screen
        options={{
          headerBackVisible: false,
          headerLeft: () => <BackLink name={notebookName} label={t.common.back} onPress={backToNotebook} />,
          headerRight: inDocument
            ? () => (
                <View style={styles.actions}>
                  <MenuButton label={t.pageMenu.label} onPress={openMenu} />
                  <PageThumbnail photoUrl={photo.data} open={!focused} onPress={openPhoto} />
                </View>
              )
            : undefined,
        }}
      />
      {inDocument ? (
        <DocumentView page={page} />
      ) : (
        <View style={styles.fill}>
          {reading()}
          {phase === "fading" ? (
            <Animated.View entering={FadeIn.duration(FADE_MS)} style={[StyleSheet.absoluteFill, styles.document]}>
              <DocumentView page={page} />
            </Animated.View>
          ) : null}
        </View>
      )}
    </>
  );
}

export default function PageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useStrings();
  const page = usePage(id);
  const notebook = useNotebook(page.data?.notebookId ?? null);

  if (page.data === null) {
    return <Redirect href="/" />;
  }
  if (page.data === undefined) {
    return page.isError ? <LoadError message={t.reading.loadFailed} onRetry={() => page.refetch()} /> : null;
  }

  async function refetchPage(): Promise<NumberedPage | null> {
    const result = await page.refetch();
    return result.isError || result.data === undefined ? null : result.data;
  }

  return (
    <LoadedPage
      key={page.data.id}
      page={page.data}
      notebookName={notebook.data?.name ?? ""}
      now={new Date(page.dataUpdatedAt)}
      refetchPage={refetchPage}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  document: {
    backgroundColor: colors.paper,
  },
});
