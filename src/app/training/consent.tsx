import { useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { PrimaryButton } from "@/components/primary-button";
import { SecondaryButton } from "@/components/secondary-button";
import { trainingStyles as styles } from "@/components/training/styles";
import { useStrings } from "@/i18n";
import { refreshTraining } from "@/training/queries";
import { trainingService } from "@/training/service";

export default function ConsentScreen() {
  const t = useStrings();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  async function agree() {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const outcome = await trainingService.grantConsent();
      if (outcome.ok || outcome.reason === "already_active") {
        void refreshTraining(queryClient, auth.userId);
        router.dismissTo("/training");
      } else if (outcome.reason === "under_age") {
        router.replace("/training/parent");
      } else if (outcome.reason === "age_missing") {
        router.replace("/training/age");
      } else {
        setProblem(
          outcome.reason === "not_registered"
            ? t.training.errors.notRegistered
            : outcome.reason === "offline"
              ? t.training.errors.offline
              : t.training.errors.failed,
        );
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t.common.back }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, styles.section]}>{t.training.consentTitle}</Text>
        {t.training.consentSections.map((section) => (
          <Text key={section} style={styles.section}>
            {section}
          </Text>
        ))}
        {problem === null ? null : <Text style={styles.error}>{problem}</Text>}
        <View style={styles.button}>
          <PrimaryButton label={t.training.agree} onPress={() => void agree()} disabled={saving} />
        </View>
        <View style={styles.button}>
          <SecondaryButton label={t.training.notNow} onPress={() => router.dismissTo("/training")} disabled={saving} />
        </View>
      </ScrollView>
    </>
  );
}
