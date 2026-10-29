import { useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, Text } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { CodeField } from "@/components/code-field";
import { trainingStyles as styles } from "@/components/training/styles";
import { useStrings } from "@/i18n";
import type { ParentConfirmFailure } from "@/training/api";
import { refreshTraining } from "@/training/queries";
import { trainingService } from "@/training/service";

export default function ParentCodeScreen() {
  const t = useStrings();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [reason, setReason] = useState<ParentConfirmFailure | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);

  function edit(digits: string) {
    setCode(digits);
    setReason(null);
  }

  async function check(digits: string) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setChecking(true);
    setReason(null);
    try {
      const outcome = await trainingService.confirmParent(digits);
      if (outcome.ok || outcome.reason === "already_active") {
        void refreshTraining(queryClient, auth.userId);
        router.dismissTo("/training");
      } else if (outcome.reason === "not_under_age") {
        router.replace("/training/consent");
      } else if (outcome.reason === "age_missing") {
        router.replace("/training/age");
      } else {
        setAttemptsLeft(outcome.attemptsLeft);
        setReason(outcome.reason);
        setCode("");
      }
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  const message =
    reason === null
      ? null
      : reason === "wrong_code"
        ? t.training.errors.wrongCode(attemptsLeft)
        : reason === "expired" || reason === "no_request"
          ? t.training.errors.codeExpired
          : reason === "not_registered"
            ? t.training.errors.notRegistered
            : reason === "offline"
              ? t.training.errors.offline
              : t.training.errors.failed;

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t.common.back }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t.training.codeTitle}</Text>
        <Text style={styles.body}>{t.training.codeBody}</Text>
        <CodeField
          label={t.training.codeLabel}
          value={code}
          onChange={edit}
          onComplete={(digits) => {
            void check(digits);
          }}
          disabled={checking}
        />
        {message === null ? null : <Text style={styles.error}>{message}</Text>}
        {reason === "expired" || reason === "no_request" ? (
          <Text accessibilityRole="link" onPress={() => router.replace("/training/parent")} style={styles.link}>
            {t.training.askAgain}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
