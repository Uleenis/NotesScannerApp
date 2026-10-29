import type { CameraView } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { PHOTO_QUALITY, type Picture } from "@/capture/photo";
import { captureService } from "@/capture/service";
import { useCameraAccess } from "@/capture/use-camera-access";
import { BlockedCapture } from "@/components/capture/blocked-capture";
import { PhotoReview } from "@/components/capture/photo-review";
import { ShutterButton } from "@/components/capture/shutter-button";
import { Viewfinder } from "@/components/capture/viewfinder";
import { SecondaryButton } from "@/components/secondary-button";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";
import type { Sheet } from "@/training/writing-test";

type Props = { sheet: Sheet; onUse: (uri: string) => void; onCancel: () => void };

export function SheetPhoto({ sheet, onUse, onCancel }: Props) {
  const t = useStrings();
  const access = useCameraAccess();
  const camera = useRef<CameraView>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const kept = useRef<string | null>(null);
  const original = useRef<Picture | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [turns, setTurns] = useState(0);
  const [turning, setTurning] = useState(false);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<"shot" | "rotate" | null>(null);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (kept.current !== null) {
        captureService.discardPhoto(kept.current);
      }
      if (original.current !== null) {
        captureService.discardPhoto(original.current.uri);
      }
    };
  }, []);

  function discardKept() {
    if (kept.current !== null) {
      captureService.discardPhoto(kept.current);
      kept.current = null;
    }
  }

  function discardOriginal() {
    if (original.current !== null) {
      captureService.discardPhoto(original.current.uri);
      original.current = null;
    }
  }

  async function takePhoto() {
    if (busy.current || camera.current === null) {
      return;
    }
    busy.current = true;
    setProblem(null);
    try {
      const picture = await camera.current.takePictureAsync({ quality: PHOTO_QUALITY, exif: true, shutterSound: false });
      if (!mounted.current) {
        captureService.discardPhoto(picture.uri);
        return;
      }
      original.current = picture;
      let prepared: string;
      try {
        prepared = await captureService.preparePhoto(picture, 0);
      } catch (error) {
        discardOriginal();
        throw error;
      }
      if (!mounted.current) {
        captureService.discardPhoto(prepared);
        return;
      }
      kept.current = prepared;
      setTurns(0);
      setUri(prepared);
    } catch {
      if (mounted.current) {
        setProblem("shot");
      }
    } finally {
      busy.current = false;
    }
  }

  async function rotate() {
    const picture = original.current;
    if (busy.current || picture === null) {
      return;
    }
    busy.current = true;
    setTurning(true);
    setProblem(null);
    const next = (turns + 1) % 4;
    try {
      const turned = await captureService.preparePhoto(picture, next);
      if (!mounted.current || original.current !== picture) {
        captureService.discardPhoto(turned);
        return;
      }
      discardKept();
      kept.current = turned;
      setUri(turned);
      setTurns(next);
    } catch {
      if (mounted.current) {
        setProblem("rotate");
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setTurning(false);
      }
    }
  }

  function retake() {
    discardKept();
    discardOriginal();
    setProblem(null);
    setUri(null);
  }

  function use() {
    if (kept.current === null) {
      return;
    }
    const photo = kept.current;
    kept.current = null;
    discardOriginal();
    onUse(photo);
  }

  if (uri !== null) {
    return (
      <PhotoReview
        actionLabel={t.training.writing.useThis}
        message={problem === "rotate" ? t.capture.rotateFailed : null}
        onRead={use}
        onRetake={retake}
        onRotate={() => void rotate()}
        photoUri={uri}
        sending={false}
        title={t.training.writing.reviewTitle(sheet)}
        turning={turning}
      />
    );
  }
  if (access === "denied") {
    return <BlockedCapture actionLabel={t.capture.openSettings} message={t.capture.cameraNeeded} onAction={() => Linking.openSettings()} />;
  }
  if (access !== "granted") {
    return null;
  }
  return (
    <View style={styles.stage}>
      <Text style={styles.title}>{t.training.writing.sheetTitle(sheet)}</Text>
      <Viewfinder flash={false} onReady={onReady} ref={camera} />
      <Text style={styles.hint}>{t.capture.hint}</Text>
      {problem === "shot" ? <Text style={styles.notice}>{t.training.writing.errors.shot}</Text> : null}
      <View style={styles.shutter}>
        <ShutterButton disabled={!ready} onPress={() => void takePhoto()} />
      </View>
      <SecondaryButton label={t.common.cancel} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    gap: 12,
  },
  title: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontWeight: "600",
    textAlign: "center",
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
  shutter: {
    alignItems: "center",
  },
});
