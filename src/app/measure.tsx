import { Redirect, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import { measureDeps, shareMeasure } from "@/capture/measure";
import { scanForMeasure } from "@/capture/scanner";
import { PrimaryButton } from "@/components/primary-button";
import { SecondaryButton } from "@/components/secondary-button";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

type Notice = "unavailable" | "failed" | "shareFailed";

function Measure() {
  const t = useStrings();
  const scanned = useRef<string[]>([]);
  const mounted = useRef(true);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scanned.current.forEach(measureDeps.discard);
      scanned.current = [];
    };
  }, []);

  function forget() {
    scanned.current.forEach(measureDeps.discard);
    scanned.current = [];
    setCount(0);
  }

  async function scan() {
    setBusy(true);
    setNotice(null);
    forget();
    const result = await scanForMeasure();
    if (!mounted.current) {
      if (result.status === "scanned") {
        result.uris.forEach(measureDeps.discard);
      }
      return;
    }
    if (result.status === "scanned") {
      scanned.current = result.uris;
      setCount(result.uris.length);
    } else if (result.status === "unavailable" || result.status === "failed") {
      setNotice(result.status);
    }
    setBusy(false);
  }

  async function share() {
    const uris = scanned.current;
    scanned.current = [];
    setCount(0);
    setBusy(true);
    setNotice(null);
    const shared = await shareMeasure(uris, measureDeps);
    if (!mounted.current) {
      return;
    }
    if (!shared) {
      setNotice("shareFailed");
    }
    setBusy(false);
  }

  const notices: Record<Notice, string> = { unavailable: t.measure.unavailable, failed: t.measure.failed, shareFailed: t.measure.shareFailed };

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <Stack.Screen options={{ title: t.measure.title }} />
      <Text style={styles.note}>{t.measure.note}</Text>
      <PrimaryButton disabled={busy} label={t.measure.scan} onPress={() => void scan()} />
      {count > 0 ? <Text style={styles.status}>{t.measure.scanned(count)}</Text> : null}
      {count > 0 ? <SecondaryButton disabled={busy} label={t.measure.share} onPress={() => void share()} /> : null}
      {notice !== null ? <Text style={styles.status}>{notices[notice]}</Text> : null}
    </ScrollView>
  );
}

export default function MeasureScreen() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <Measure />;
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
  },
  content: {
    gap: 16,
    padding: 20,
  },
  note: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
  status: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
});
