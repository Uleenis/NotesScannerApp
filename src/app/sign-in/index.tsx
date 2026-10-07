import { Stack, router } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { accountService } from "@/auth/account-service";
import type { AccountFailure } from "@/auth/account-errors";
import { useAuth } from "@/auth/auth-provider";
import { HeaderTextButton } from "@/components/header-text-button";
import { PrimaryButton } from "@/components/primary-button";
import { useStrings } from "@/i18n";
import { legalLinks } from "@/lib/legal-links";
import { openLink } from "@/lib/open-link";
import { colors, radius, typography } from "@/theme";

type Mode = "signup" | "signin";

export default function SignInScreen() {
  const t = useStrings();
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);

  const isAnonymous = auth.status !== "ready" || auth.isAnonymous;

  function edit(text: string) {
    setEmail(text);
    setFailure(null);
  }

  function switchTo(next: Mode) {
    setMode(next);
    setFailure(null);
  }

  async function sendCode() {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSending(true);
    setFailure(null);
    try {
      const outcome = mode === "signup" ? await accountService.startSignUp(email) : await accountService.startSignIn(email, isAnonymous);
      if (outcome.ok) {
        router.push({ pathname: "/sign-in/code", params: { email: email.trim().toLowerCase(), mode } });
      } else {
        setFailure(outcome.reason);
      }
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  function receiveCode() {
    void sendCode();
  }

  const signingUp = mode === "signup";

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => <HeaderTextButton label={t.common.cancel} onPress={() => router.back()} />,
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{signingUp ? t.signIn.signUpTitle : t.signIn.signInTitle}</Text>
        <Text style={styles.body}>{signingUp ? t.signIn.signUpBody : t.signIn.signInBody}</Text>
        <TextInput
          accessibilityLabel={t.signIn.emailLabel}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          autoFocus
          keyboardType="email-address"
          onBlur={() => setFocused(false)}
          onChangeText={edit}
          onFocus={() => setFocused(true)}
          onSubmitEditing={receiveCode}
          placeholder={t.signIn.emailPlaceholder}
          placeholderTextColor={colors.inkTertiary}
          returnKeyType="send"
          style={[styles.field, focused && styles.fieldFocused]}
          textContentType="emailAddress"
          value={email}
        />
        {failure === null ? null : <Text style={styles.error}>{t.accountErrors[failure]}</Text>}
        <View style={styles.button}>
          <PrimaryButton label={t.signIn.receiveCode} onPress={receiveCode} disabled={sending} />
        </View>
        <Text style={styles.switch}>
          {signingUp ? t.signIn.haveAccount : t.signIn.noAccount}{" "}
          <Text accessibilityRole="link" onPress={() => switchTo(signingUp ? "signin" : "signup")} style={styles.link}>
            {signingUp ? t.signIn.signInLink : t.signIn.signUpLink}
          </Text>
        </Text>
        <Text style={styles.legal}>
          {t.signIn.legalBefore}
          <Text accessibilityRole="link" onPress={() => openLink(legalLinks.terms)} style={styles.link}>
            {t.signIn.terms}
          </Text>
          {t.signIn.legalMiddle}
          <Text accessibilityRole="link" onPress={() => openLink(legalLinks.privacy)} style={styles.link}>
            {t.signIn.privacy}
          </Text>
          {t.signIn.legalAfter}
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingBottom: 32,
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
  field: {
    ...typography.interfaceBody,
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldFocused: {
    borderColor: colors.ink,
  },
  error: {
    ...typography.interfaceSecondary,
    color: colors.danger,
    paddingTop: 12,
  },
  button: {
    paddingTop: 16,
  },
  switch: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingTop: 20,
    textAlign: "center",
  },
  link: {
    color: colors.ink,
    textDecorationLine: "underline",
  },
  legal: {
    ...typography.footnote,
    color: colors.inkSecondary,
    marginTop: "auto",
    paddingTop: 40,
    textAlign: "center",
  },
});
