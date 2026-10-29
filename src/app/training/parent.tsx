import { useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { PrimaryButton } from "@/components/primary-button";
import { trainingStyles as styles } from "@/components/training/styles";
import { useStrings } from "@/i18n";
import { colors } from "@/theme";
import type { ParentRequestFailure } from "@/training/api";
import { refreshTraining } from "@/training/queries";
import { trainingService } from "@/training/service";

export default function ParentScreen() {
  const t = useStrings();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);

  function edit(text: string) {
    setEmail(text);
    setProblem(null);
  }

  function messageFor(reason: ParentRequestFailure): string {
    switch (reason) {
      case "invalid_email":
        return t.training.errors.invalidEmail;
      case "same_email":
        return t.training.errors.sameEmail;
      case "send_limit":
        return t.training.errors.sendLimit;
      case "unavailable":
        return t.training.errors.unavailable;
      case "send_failed":
        return t.training.errors.sendFailed;
      case "not_registered":
        return t.training.errors.notRegistered;
      case "offline":
        return t.training.errors.offline;
      default:
        return t.training.errors.failed;
    }
  }

  async function send() {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSending(true);
    setProblem(null);
    try {
      const outcome = await trainingService.requestParent(email);
      if (outcome.ok) {
        router.push("/training/code");
      } else if (outcome.reason === "not_under_age") {
        router.replace("/training/consent");
      } else if (outcome.reason === "age_missing") {
        router.replace("/training/age");
      } else if (outcome.reason === "already_active") {
        void refreshTraining(queryClient, auth.userId);
        router.dismissTo("/training");
      } else {
        setProblem(messageFor(outcome.reason));
      }
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t.common.back }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t.training.parentTitle}</Text>
        <Text style={styles.body}>{t.training.parentBody}</Text>
        <TextInput
          accessibilityLabel={t.training.parentEmailLabel}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          autoFocus
          keyboardType="email-address"
          onBlur={() => setFocused(false)}
          onChangeText={edit}
          onFocus={() => setFocused(true)}
          onSubmitEditing={() => void send()}
          placeholder={t.training.parentEmailPlaceholder}
          placeholderTextColor={colors.inkTertiary}
          returnKeyType="send"
          style={[styles.field, focused && styles.fieldFocused]}
          textContentType="emailAddress"
          value={email}
        />
        {problem === null ? null : <Text style={styles.error}>{problem}</Text>}
        <View style={styles.button}>
          <PrimaryButton label={t.training.sendCode} onPress={() => void send()} disabled={sending} />
        </View>
        <Text accessibilityRole="link" onPress={() => router.push("/training/code")} style={styles.link}>
          {t.training.alreadyHaveCode}
        </Text>
      </ScrollView>
    </>
  );
}
