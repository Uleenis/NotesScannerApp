import { useQueryClient } from "@tanstack/react-query";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { accountService } from "@/auth/account-service";
import type { AccountFailure } from "@/auth/account-errors";
import { useAuth } from "@/auth/auth-provider";
import { CodeField } from "@/components/code-field";
import { useStrings } from "@/i18n";
import { refreshPages } from "@/pages/queries";
import { colors, typography } from "@/theme";

const RESEND_MS = 30_000;
const TICK_MS = 250;

export default function CodeScreen() {
  const t = useStrings();
  const params = useLocalSearchParams<{ email: string; mode: string }>();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [checking, setChecking] = useState(false);
  const [resent, setResent] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_MS / 1000);
  const startedAt = useRef(0);
  const checkingNow = useRef(false);
  const resending = useRef(false);

  const email = typeof params.email === "string" ? params.email : "";
  const signingUp = params.mode !== "signin";
  const isAnonymous = auth.status !== "ready" || auth.isAnonymous;

  useEffect(() => {
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((RESEND_MS - (Date.now() - startedAt.current)) / 1000)));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  function edit(digits: string) {
    setCode(digits);
    setFailure(null);
    setResent(false);
  }

  async function check(digits: string) {
    if (checkingNow.current) {
      return;
    }
    checkingNow.current = true;
    setChecking(true);
    setFailure(null);
    try {
      const outcome = signingUp
        ? await accountService.confirmSignUp(email, digits)
        : await accountService.confirmSignIn(email, digits, isAnonymous);
      if (outcome.ok) {
        void refreshPages(queryClient, auth.userId);
        router.dismissAll();
        router.dismiss();
      } else {
        setFailure(outcome.reason);
        setCode("");
      }
    } finally {
      checkingNow.current = false;
      setChecking(false);
    }
  }

  async function sendAgain() {
    if (resending.current) {
      return;
    }
    resending.current = true;
    try {
      const outcome = signingUp ? await accountService.startSignUp(email) : await accountService.startSignIn(email, isAnonymous);
      if (outcome.ok) {
        startedAt.current = Date.now();
        setSeconds(RESEND_MS / 1000);
        setResent(true);
      } else {
        setFailure(outcome.reason);
      }
    } finally {
      resending.current = false;
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t.common.back }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t.code.title}</Text>
        <Text style={styles.body}>{t.code.body(email)}</Text>
        <CodeField
          label={t.code.label}
          value={code}
          onChange={edit}
          onComplete={(digits) => {
            void check(digits);
          }}
          disabled={checking}
        />
        {failure === null ? null : <Text style={styles.error}>{t.accountErrors[failure]}</Text>}
        {resent ? <Text style={styles.resent}>{t.code.resent}</Text> : null}
        <View style={styles.resendRow}>
          <Text style={styles.resend}>
            {t.code.nothingReceived}{" "}
            {seconds > 0 ? (
              <Text style={styles.wait}>{t.code.resendIn(seconds)}</Text>
            ) : (
              <Text
                accessibilityRole="link"
                onPress={() => {
                  void sendAgain();
                }}
                style={styles.link}
              >
                {t.code.resend}
              </Text>
            )}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  title: {
    ...typography.pageTitle,
    color: colors.ink,
  },
  body: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    paddingBottom: 28,
    paddingTop: 12,
  },
  error: {
    ...typography.interfaceSecondary,
    color: colors.danger,
    paddingTop: 16,
  },
  resent: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingTop: 16,
  },
  resendRow: {
    alignItems: "center",
    paddingTop: 24,
  },
  resend: {
    ...typography.interfaceSecondary,
    color: colors.ink,
  },
  wait: {
    color: colors.inkSecondary,
  },
  link: {
    color: colors.ink,
    textDecorationLine: "underline",
  },
});
