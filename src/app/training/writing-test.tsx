import { Stack, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { captureService } from "@/capture/service";
import { LoadError } from "@/components/load-error";
import { PrimaryButton } from "@/components/primary-button";
import { SecondaryButton } from "@/components/secondary-button";
import { SheetCard } from "@/components/training/sheet-card";
import { SheetPhoto } from "@/components/training/sheet-photo";
import { trainingStyles } from "@/components/training/styles";
import { useLanguage, useStrings } from "@/i18n";
import { colors, typography } from "@/theme";
import { useTrainingState } from "@/training/queries";
import { runWritingTest, type Resume, type RunResult } from "@/training/run-writing-test";
import { writingService } from "@/training/writing-service";
import { SHEETS, templateFor, type Sheet } from "@/training/writing-test";

type Stage = "write" | "shoot" | "sending" | "result";

type Photos = [string | null, string | null];

type Problem = Exclude<RunResult["status"], "accepted" | "rejected">;

export default function WritingTestScreen() {
  const t = useStrings();
  const w = t.training.writing;
  const template = templateFor(useLanguage());
  const training = useTrainingState();
  const [stage, setStage] = useState<Stage>("write");
  const [photos, setPhotos] = useState<Photos>([null, null]);
  const [sheet, setSheet] = useState<Sheet>(1);
  const [result, setResult] = useState<RunResult | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const latest = useRef<Photos>([null, null]);

  useEffect(() => {
    latest.current = photos;
  }, [photos]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latest.current.forEach((uri) => {
        if (uri !== null) {
          captureService.discardPhoto(uri);
        }
      });
    };
  }, []);

  const messages: Record<Problem, string> = {
    failed: w.errors.failed,
    consent_required: w.errors.consent,
    in_progress: w.errors.inProgress,
    limit: w.errors.limit,
    offline: w.errors.offline,
    photo: w.errors.photo,
    tooLarge: w.errors.tooLarge,
    unavailable: w.errors.unavailable,
    timeout: w.errors.timeout,
    error: w.errors.error,
  };

  function forget(index: number) {
    const uri = latest.current[index];
    if (uri !== null) {
      captureService.discardPhoto(uri);
    }
  }

  function setPhoto(index: number, uri: string | null) {
    setPhotos((now) => {
      const next: Photos = [...now];
      next[index] = uri;
      return next;
    });
  }

  function useShot(uri: string) {
    forget(sheet - 1);
    setPhoto(sheet - 1, uri);
    setProblem(null);
    setStage("write");
  }

  async function send(from: Resume | null) {
    const [first, second] = photos;
    if (busy.current || first === null || second === null) {
      return;
    }
    busy.current = true;
    setStage("sending");
    setProblem(null);
    let outcome: RunResult;
    try {
      outcome = await runWritingTest(writingService.deps(), { template, photos: [first, second], resume: from });
    } catch {
      outcome = { status: "error", resume: from };
    } finally {
      busy.current = false;
    }
    if (!mounted.current) {
      return;
    }
    setResume("resume" in outcome ? outcome.resume : null);
    setResult(outcome);
    if (outcome.status === "accepted") {
      forget(0);
      forget(1);
      setPhotos([null, null]);
    }
    if ((outcome.status === "photo" || outcome.status === "tooLarge") && outcome.resume !== null) {
      const index = outcome.resume.uploaded.indexOf(false);
      forget(index);
      setPhoto(index, null);
      setProblem(outcome.status);
      setStage("write");
      return;
    }
    setStage("result");
  }

  function writeAgain(sheets: readonly Sheet[]) {
    sheets.forEach((one) => {
      forget(one - 1);
      setPhoto(one - 1, null);
    });
    setResume(null);
    setResult(null);
    setStage("write");
  }

  function retry() {
    setResume(null);
    setResult(null);
    setStage("write");
  }

  const header = <Stack.Screen options={{ title: w.title }} />;

  if (training.isError) {
    return (
      <>
        {header}
        <LoadError message={t.training.loadFailed} onRetry={() => void training.refetch()} />
      </>
    );
  }
  if (training.data === undefined) {
    return (
      <>
        {header}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </>
    );
  }
  if (training.data.consent === "none") {
    return (
      <>
        {header}
        <ScrollView contentContainerStyle={trainingStyles.content}>
          <Text style={trainingStyles.body}>{w.errors.consent}</Text>
        </ScrollView>
      </>
    );
  }

  if (stage === "shoot") {
    return (
      <>
        {header}
        <View style={styles.camera}>
          <SheetPhoto onCancel={() => setStage("write")} onUse={useShot} sheet={sheet} />
        </View>
      </>
    );
  }

  if (stage === "sending") {
    return (
      <>
        {header}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.title}>{w.checkingTitle}</Text>
          <Text style={trainingStyles.note}>{w.checkingBody}</Text>
        </View>
      </>
    );
  }

  if (stage === "result" && result !== null) {
    if (result.status === "accepted") {
      return (
        <>
          {header}
          <ScrollView contentContainerStyle={trainingStyles.content}>
            <Text style={styles.title}>{w.acceptedTitle}</Text>
            <Text style={trainingStyles.body}>{w.acceptedBody}</Text>
            <PrimaryButton label={w.done} onPress={() => router.back()} />
          </ScrollView>
        </>
      );
    }
    if (result.status === "rejected") {
      const sheets = result.redo.length === 0 ? [...SHEETS] : result.redo;
      return (
        <>
          {header}
          <ScrollView contentContainerStyle={trainingStyles.content}>
            <Text style={styles.title}>{w.rejectedTitle}</Text>
            <Text style={trainingStyles.body}>{w.rejectedBody(sheets)}</Text>
            <Text style={trainingStyles.note}>{w.rejectedTip}</Text>
            <View style={trainingStyles.button}>
              <PrimaryButton label={w.redo} onPress={() => writeAgain(sheets)} />
            </View>
          </ScrollView>
        </>
      );
    }
    const final = result.status === "consent_required" || result.status === "in_progress" || result.status === "limit";
    const waiting = result.status === "timeout";
    return (
      <>
        {header}
        <ScrollView contentContainerStyle={trainingStyles.content}>
          <Text style={trainingStyles.body}>{messages[result.status]}</Text>
          {final ? (
            <PrimaryButton label={w.done} onPress={() => router.back()} />
          ) : result.status === "failed" ? (
            <PrimaryButton label={w.tryAgain} onPress={retry} />
          ) : (
            <PrimaryButton label={waiting ? w.checkAgain : w.tryAgain} onPress={() => void send(resume)} />
          )}
        </ScrollView>
      </>
    );
  }

  const ready = photos[0] !== null && photos[1] !== null;
  return (
    <>
      {header}
      <ScrollView contentContainerStyle={trainingStyles.content}>
        <Text style={trainingStyles.body}>{w.intro}</Text>
        <Text style={trainingStyles.section}>{w.copyRule}</Text>
        {SHEETS.map((one) => (
          <View key={one} style={styles.sheet}>
            <SheetCard sheet={one} template={template} />
            <SecondaryButton
              label={photos[one - 1] === null ? w.photograph(one) : w.photographAgain(one)}
              onPress={() => {
                setSheet(one);
                setStage("shoot");
              }}
            />
            {photos[one - 1] === null ? null : <Text style={trainingStyles.note}>{w.photographed}</Text>}
          </View>
        ))}
        {problem === null ? null : <Text style={trainingStyles.error}>{messages[problem]}</Text>}
        <View style={trainingStyles.button}>
          <PrimaryButton disabled={!ready} label={w.send} onPress={() => void send(resume)} />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  camera: {
    flex: 1,
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  title: {
    ...typography.pageTitle,
    color: colors.ink,
    textAlign: "center",
  },
  sheet: {
    gap: 8,
    paddingBottom: 20,
  },
});
