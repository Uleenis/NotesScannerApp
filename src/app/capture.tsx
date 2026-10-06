import type { CameraView } from "expo-camera";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { blockForReason, remainingCounter, type Counter } from "@/capture/allowance";
import { limitParams } from "@/capture/limit-route";
import { PHOTO_QUALITY } from "@/capture/photo";
import { useAllowance, useLatestNotebookId, useSendPage } from "@/capture/queries";
import type { SendResult } from "@/capture/send-page";
import { captureService } from "@/capture/service";
import { useCameraAccess } from "@/capture/use-camera-access";
import { useOffline } from "@/capture/use-network";
import { BlockedCapture } from "@/components/capture/blocked-capture";
import { CaptureTopBar } from "@/components/capture/capture-top-bar";
import { NotebookPicker } from "@/components/capture/notebook-picker";
import { PhotoReview } from "@/components/capture/photo-review";
import { ShutterButton } from "@/components/capture/shutter-button";
import { Viewfinder } from "@/components/capture/viewfinder";
import { LoadError } from "@/components/load-error";
import { useStrings } from "@/i18n";
import type { NotebookSummary } from "@/notebooks/notebooks";
import { useNotebooks } from "@/notebooks/queries";
import { colors, typography } from "@/theme";

type Failure = "network" | "photo" | "tooLarge" | "failed";

const LATEST_NOTEBOOK_WAIT_MS = 2500;

function Frame({ top, children }: { top: ReactNode; children: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 16, paddingTop: insets.top + 8 }]}>
      {top}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function leave() {
  router.back();
}

type StageProps = {
  camera: RefObject<CameraView | null>;
  flash: boolean;
  shotFailed: boolean;
  counter: Counter | null;
  onShoot: () => void;
};

function Stage({ camera, flash, shotFailed, counter, onShoot }: StageProps) {
  const t = useStrings();
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  return (
    <>
      <Viewfinder flash={flash} onReady={onReady} ref={camera} />
      <Text style={styles.hint}>{t.capture.hint}</Text>
      {shotFailed ? <Text style={styles.notice}>{t.capture.shotFailed}</Text> : null}
      {counter === null ? null : (
        <Text style={styles.counter}>
          {counter.kind === "trial" ? t.capture.counterTrial(counter.remaining) : t.capture.counterMonth(counter.remaining)}
        </Text>
      )}
      <View style={styles.shutter}>
        <ShutterButton disabled={!ready} onPress={onShoot} />
      </View>
    </>
  );
}

function Capture({ notebooks: list, requested }: { notebooks: NotebookSummary[]; requested: string | undefined }) {
  const t = useStrings();
  const offline = useOffline();
  const access = useCameraAccess();
  const latest = useLatestNotebookId();
  const allowance = useAllowance();
  const send = useSendPage();

  const camera = useRef<CameraView>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const keptPhoto = useRef<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [flash, setFlash] = useState(false);
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [shotFailed, setShotFailed] = useState(false);

  const waitingForLatest = requested === undefined && latest.isLoading && !gaveUpWaiting;
  const cameraShown = photoUri === null && !offline && !waitingForLatest && access === "granted";

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => setGaveUpWaiting(true), LATEST_NOTEBOOK_WAIT_MS);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      if (keptPhoto.current !== null && !busy.current) {
        captureService.discardPhoto(keptPhoto.current);
      }
    };
  }, []);

  const exists = (id: string | null | undefined): id is string => id !== null && id !== undefined && list.some((item) => item.id === id);
  const selected = list.find((item) => item.id === [chosenId, requested, latest.data].find(exists)) ?? list[0];
  const counter = remainingCounter(allowance.data);

  function discardPhoto() {
    if (keptPhoto.current !== null) {
      captureService.discardPhoto(keptPhoto.current);
      keptPhoto.current = null;
    }
  }

  async function takePhoto() {
    if (busy.current || camera.current === null) {
      return;
    }
    busy.current = true;
    setShotFailed(false);
    try {
      const picture = await camera.current.takePictureAsync({ quality: PHOTO_QUALITY, exif: false, shutterSound: true });
      const uri = await captureService.preparePhoto(picture);
      if (!mounted.current) {
        captureService.discardPhoto(uri);
        return;
      }
      keptPhoto.current = uri;
      setPhotoUri(uri);
      setPageId(null);
      setFailure(null);
    } catch {
      if (mounted.current) {
        setShotFailed(true);
      }
    } finally {
      busy.current = false;
    }
  }

  function retake() {
    discardPhoto();
    setPhotoUri(null);
    setPageId(null);
    setFailure(null);
  }

  async function submit() {
    if (busy.current || photoUri === null) {
      return;
    }
    busy.current = true;
    setFailure(null);
    try {
      const result = await send.mutateAsync({ notebookId: selected.id, photoUri, pageId }).catch((): SendResult => ({ status: "failed", pageId }));
      if (!mounted.current) {
        return;
      }
      if (result.pageId !== null) {
        setPageId(result.pageId);
      }
      if (result.status === "sent") {
        keptPhoto.current = null;
        router.replace(`/page/${result.pageId}`);
      } else if (result.status === "limit") {
        const fresh = await captureService.allowance().catch(() => null);
        if (!mounted.current) {
          return;
        }
        discardPhoto();
        router.replace({ pathname: "/limit", params: limitParams(blockForReason(result.reason, fresh)) });
      } else {
        setFailure(result.status);
      }
    } finally {
      busy.current = false;
    }
  }

  const failureMessages: Record<Failure, string> = {
    network: t.capture.noConnection,
    photo: t.capture.photoUnreadable,
    tooLarge: t.capture.photoTooLarge,
    failed: t.capture.sendFailed,
  };

  let body: ReactNode = null;
  if (photoUri !== null) {
    body = (
      <PhotoReview
        message={failure === null ? null : failureMessages[failure]}
        onRead={() => void submit()}
        onRetake={retake}
        photoUri={photoUri}
        sending={send.isPending}
        title={t.capture.reviewTitle(selected.pageCount + 1, selected.name)}
      />
    );
  } else if (offline) {
    body = <BlockedCapture message={t.capture.noConnection} />;
  } else if (waitingForLatest) {
    body = null;
  } else if (access === "denied") {
    body = <BlockedCapture actionLabel={t.capture.openSettings} message={t.capture.cameraNeeded} onAction={() => Linking.openSettings()} />;
  } else if (access === "granted") {
    body = <Stage camera={camera} counter={counter} flash={flash} onShoot={() => void takePhoto()} shotFailed={shotFailed} />;
  }

  const top =
    photoUri === null || send.isPending ? (
      <>
        <CaptureTopBar
          flash={cameraShown ? flash : null}
          notebookName={cameraShown ? selected.name : null}
          onCancel={leave}
          onFlash={() => setFlash((on) => !on)}
          onNotebook={() => setPicking((open) => !open)}
        />
        {picking && cameraShown ? (
          <NotebookPicker
            notebooks={list}
            onPick={(id) => {
              setChosenId(id);
              setPicking(false);
            }}
            selectedId={selected.id}
          />
        ) : null}
      </>
    ) : null;

  return <Frame top={top}>{body}</Frame>;
}

export default function CaptureScreen() {
  const { notebook: requested } = useLocalSearchParams<{ notebook?: string }>();
  const t = useStrings();
  const offline = useOffline();
  const notebooks = useNotebooks();
  const list = notebooks.data;

  if (list === undefined) {
    return (
      <Frame top={<CaptureTopBar flash={null} notebookName={null} onCancel={leave} />}>
        {offline ? (
          <BlockedCapture message={t.capture.noConnection} />
        ) : notebooks.isFetching ? null : (
          <LoadError message={t.library.loadFailed} onRetry={() => notebooks.refetch()} />
        )}
      </Frame>
    );
  }
  if (list.length === 0) {
    return <Redirect href="/" />;
  }
  return <Capture notebooks={list} requested={requested} />;
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
    flex: 1,
  },
  body: {
    flex: 1,
    gap: 12,
    paddingHorizontal: 20,
  },
  hint: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  notice: {
    ...typography.interfaceSecondary,
    color: colors.ink,
    textAlign: "center",
  },
  counter: {
    ...typography.footnote,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  shutter: {
    alignItems: "center",
  },
});
