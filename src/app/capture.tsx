import type { CameraView } from "expo-camera";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { blockForReason, remainingCounter } from "@/capture/allowance";
import { limitParams } from "@/capture/limit-route";
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
import { useStrings } from "@/i18n";
import { useNotebooks } from "@/notebooks/queries";
import { colors, typography } from "@/theme";

type Failure = "network" | "photo" | "failed";

export default function CaptureScreen() {
  const { notebook: requested } = useLocalSearchParams<{ notebook?: string }>();
  const t = useStrings();
  const insets = useSafeAreaInsets();
  const offline = useOffline();
  const access = useCameraAccess();
  const notebooks = useNotebooks();
  const latest = useLatestNotebookId();
  const allowance = useAllowance();
  const send = useSendPage();

  const camera = useRef<CameraView>(null);
  const busy = useRef(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [flash, setFlash] = useState(false);
  const [ready, setReady] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const onReady = useCallback(() => setReady(true), []);

  const list = notebooks.data;
  if (list === undefined || latest.isPending) {
    return <View style={styles.screen} />;
  }
  if (list.length === 0) {
    return <Redirect href="/" />;
  }
  const exists = (id: string | null | undefined): id is string => id !== null && id !== undefined && list.some((item) => item.id === id);
  const selected = list.find((item) => item.id === [chosenId, requested, latest.data].find(exists)) ?? list[0];
  const counter = remainingCounter(allowance.data);
  const cameraShown = photoUri === null && !offline && access === "granted";

  async function takePhoto() {
    if (!ready || busy.current || camera.current === null) {
      return;
    }
    busy.current = true;
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.9, exif: false, shutterSound: true });
      setPhotoUri(picture.uri);
      setPageId(null);
      setFailure(null);
    } finally {
      busy.current = false;
    }
  }

  function retake() {
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
      if (result.pageId !== null) {
        setPageId(result.pageId);
      }
      if (result.status === "sent") {
        router.replace(`/page/${result.pageId}`);
      } else if (result.status === "limit") {
        const fresh = await captureService.allowance().catch(() => null);
        router.push({ pathname: "/limit", params: limitParams(blockForReason(result.reason, fresh)) });
      } else {
        setFailure(result.status);
      }
    } finally {
      busy.current = false;
    }
  }

  const failureMessage =
    failure === "network" ? t.capture.noConnection : failure === "photo" ? t.capture.photoUnreadable : failure === "failed" ? t.capture.sendFailed : null;

  let body: ReactNode = null;
  if (photoUri !== null) {
    body = (
      <PhotoReview
        message={failureMessage}
        onRead={() => void submit()}
        onRetake={retake}
        photoUri={photoUri}
        sending={send.isPending}
        title={t.capture.reviewTitle(selected.pageCount + 1, selected.name)}
      />
    );
  } else if (offline) {
    body = <BlockedCapture message={t.capture.noConnection} />;
  } else if (access === "denied") {
    body = <BlockedCapture actionLabel={t.capture.openSettings} message={t.capture.cameraNeeded} onAction={() => Linking.openSettings()} />;
  } else if (access === "granted") {
    body = (
      <>
        <Viewfinder flash={flash} onReady={onReady} ref={camera} />
        <Text style={styles.hint}>{t.capture.hint}</Text>
        {counter === null ? null : (
          <Text style={styles.counter}>
            {counter.kind === "trial" ? t.capture.counterTrial(counter.remaining) : t.capture.counterMonth(counter.remaining)}
          </Text>
        )}
        <View style={styles.shutter}>
          <ShutterButton disabled={!ready} onPress={() => void takePhoto()} />
        </View>
      </>
    );
  }

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 16, paddingTop: insets.top + 8 }]}>
      {photoUri === null ? (
        <CaptureTopBar
          flash={cameraShown ? flash : null}
          notebookName={cameraShown ? selected.name : null}
          onCancel={() => router.back()}
          onFlash={() => setFlash((on) => !on)}
          onNotebook={() => setPicking((open) => !open)}
        />
      ) : null}
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
      <View style={styles.body}>{body}</View>
    </View>
  );
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
  counter: {
    ...typography.footnote,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  shutter: {
    alignItems: "center",
  },
});
