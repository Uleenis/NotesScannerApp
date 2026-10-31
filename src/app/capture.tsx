import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FREE_MONTHLY_PAGES, remainingCounter, TRIAL_PAGES, type Block } from "@/capture/allowance";
import { useAllowance, useLatestNotebookId } from "@/capture/queries";
import { seriesLimit } from "@/capture/series";
import { useOffline } from "@/capture/use-network";
import { useSeries, type Phase } from "@/capture/use-series";
import { BlockedCapture } from "@/components/capture/blocked-capture";
import { BlurryPages } from "@/components/capture/blurry-pages";
import { CaptureTopBar } from "@/components/capture/capture-top-bar";
import { NotebookPicker } from "@/components/capture/notebook-picker";
import { SeriesNotice } from "@/components/capture/series-notice";
import { LoadError } from "@/components/load-error";
import { PrimaryButton } from "@/components/primary-button";
import { useStrings } from "@/i18n";
import type { Strings } from "@/i18n/en";
import type { NotebookSummary } from "@/notebooks/notebooks";
import { useNotebooks } from "@/notebooks/queries";
import { colors, typography } from "@/theme";

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

function blockReason(t: Strings, block: Block): string {
  switch (block.kind) {
    case "month":
      return t.limit.monthTitle(block.max);
    case "trial":
      return t.limit.trialBody(TRIAL_PAGES, FREE_MONTHLY_PAGES);
    case "daily":
      return t.limit.dailyBody;
  }
}

function Capture({
  notebooks: list,
  requested,
  requestedChapter,
}: {
  notebooks: NotebookSummary[];
  requested: string | undefined;
  requestedChapter: string | undefined;
}) {
  const t = useStrings();
  const offline = useOffline();
  const latest = useLatestNotebookId();
  const allowance = useAllowance();

  const [chosenId, setChosenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setGaveUpWaiting(true), LATEST_NOTEBOOK_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  const exists = (id: string | null | undefined): id is string => id !== null && id !== undefined && list.some((item) => item.id === id);
  const selected = list.find((item) => item.id === [chosenId, requested, latest.data].find(exists)) ?? list[0];
  const chapterId = requestedChapter !== undefined && selected.id === requested ? requestedChapter : null;

  const waiting = ((requested === undefined && latest.isLoading) || allowance.isLoading) && !gaveUpWaiting;
  const series = useSeries({ notebookId: selected.id, chapterId }, seriesLimit(allowance.data), !waiting && !offline);
  const { phase } = series;
  const counter = remainingCounter(allowance.data);

  const top = (
    <>
      <CaptureTopBar
        flash={null}
        notebookName={phase.kind === "idle" && !waiting ? selected.name : null}
        onCancel={series.leave}
        onNotebook={() => setPicking((open) => !open)}
      />
      {picking && phase.kind === "idle" ? (
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
  );

  function notice(current: Phase): ReactNode {
    switch (current.kind) {
      case "scanning":
        return <SeriesNotice busy lines={[t.capture.scanning]} />;
      case "preparing":
        return <SeriesNotice busy lines={[t.capture.preparing(current.page, current.total)]} />;
      case "sending":
        return <SeriesNotice busy lines={[t.capture.sendingSeries(current.page, current.total)]} />;
      case "interrupted":
        return (
          <SeriesNotice
            actions={[{ label: t.capture.retry, onPress: series.retry, disabled: offline }]}
            lines={[t.capture.interrupted(current.pending), ...(offline ? [t.capture.noConnection] : [])]}
          />
        );
      case "ended":
        return (
          <SeriesNotice
            actions={[{ label: t.limit.understood, onPress: series.close }]}
            lines={[
              ...(current.notSent > 0 ? [t.capture.notSent(current.notSent)] : []),
              ...(current.block === null ? [] : [blockReason(t, current.block)]),
              ...(current.leftOut > 0 ? [t.capture.leftOut(current.leftOut)] : []),
            ]}
          />
        );
      default:
        return null;
    }
  }

  let body: ReactNode = null;
  if (phase.kind === "idle") {
    if (offline) {
      body = <BlockedCapture message={t.capture.noConnection} />;
    } else if (!waiting) {
      body = (
        <View style={styles.idle}>
          <Text style={styles.hint}>{t.capture.hint}</Text>
          {phase.notice === "unavailable" ? <Text style={styles.notice}>{t.capture.scannerUnavailable}</Text> : null}
          {phase.notice === "failed" ? <Text style={styles.notice}>{t.capture.scannerFailed}</Text> : null}
          {phase.leftOut > 0 ? <Text style={styles.notice}>{t.capture.leftOut(phase.leftOut)}</Text> : null}
          {counter === null ? null : (
            <Text style={styles.counter}>
              {counter.kind === "trial" ? t.capture.counterTrial(counter.remaining) : t.capture.counterMonth(counter.remaining)}
            </Text>
          )}
          {phase.notice === "unavailable" ? null : <PrimaryButton label={t.common.scan} onPress={series.scan} />}
        </View>
      );
    }
  } else if (phase.kind === "blurry") {
    body = (
      <BlurryPages
        onRetake={series.retake}
        onSendAnyway={series.sendAnyway}
        pages={series.pages.flatMap((page, index) => (page.sharpness === "blurry" ? [{ index, uri: page.uri }] : []))}
      />
    );
  } else {
    body = notice(phase);
  }

  return <Frame top={top}>{body}</Frame>;
}

export default function CaptureScreen() {
  const { notebook: requested, chapter: requestedChapter } = useLocalSearchParams<{ notebook?: string; chapter?: string }>();
  const t = useStrings();
  const offline = useOffline();
  const notebooks = useNotebooks();
  const list = notebooks.data;

  if (list === undefined) {
    return (
      <Frame top={<CaptureTopBar flash={null} notebookName={null} onCancel={() => router.back()} />}>
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
  return <Capture notebooks={list} requested={requested} requestedChapter={requestedChapter} />;
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
  idle: {
    flex: 1,
    gap: 16,
    justifyContent: "center",
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
});
