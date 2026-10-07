import { Stack, router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";

import { accountService } from "@/auth/account-service";
import type { AccountFailure } from "@/auth/account-errors";
import { useAuth } from "@/auth/auth-provider";
import { useAllowance } from "@/capture/queries";
import { AccountGroup } from "@/components/account/account-group";
import { AccountRow } from "@/components/account/account-row";
import { HeaderTextButton } from "@/components/header-text-button";
import { useStrings } from "@/i18n";
import { legalLinks } from "@/lib/legal-links";
import { openLink } from "@/lib/open-link";
import { colors, typography } from "@/theme";

type Problem = "sign_out" | "delete" | "delete_offline";

export default function AccountScreen() {
  const t = useStrings();
  const auth = useAuth();
  const allowance = useAllowance();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = useRef(false);

  const registered = auth.status === "ready" && !auth.isAnonymous;
  const email = auth.status === "ready" ? auth.email : null;
  const counts = allowance.data === undefined || allowance.data === null ? null : t.account.pagesCount(allowance.data.used, allowance.data.max);

  async function run(action: () => Promise<{ ok: boolean; reason?: AccountFailure }>, failed: (reason: AccountFailure | undefined) => Problem) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setWorking(true);
    setProblem(null);
    try {
      const outcome = await action();
      if (outcome.ok) {
        router.dismissTo("/");
      } else {
        setProblem(failed(outcome.reason));
      }
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  function signOut() {
    void run(
      () => accountService.signOut(),
      () => "sign_out",
    );
  }

  function deleteAccount() {
    void run(
      () => accountService.deleteAccount(),
      (reason) => (reason === "offline" ? "delete_offline" : "delete"),
    );
  }

  function askToDelete() {
    if (busy.current) {
      return;
    }
    Alert.alert(t.account.deleteConfirmTitle, t.account.deleteConfirmBody, [
      { text: t.common.cancel, style: "cancel" },
      { text: t.account.deleteConfirm, style: "destructive", onPress: deleteAccount },
    ]);
  }

  const message =
    problem === "sign_out" ? t.account.signOutFailed : problem === "delete" ? t.account.deleteFailed : problem === "delete_offline" ? t.account.deleteOffline : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: t.account.title,
          headerLargeTitleEnabled: true,
          headerRight: () => <HeaderTextButton label={t.common.done} onPress={() => router.back()} />,
        }}
      />
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <AccountGroup>
          {registered ? <AccountRow label={t.account.email} value={email ?? ""} /> : null}
          <AccountRow label={registered ? t.account.pagesMonth : t.account.pagesTrial} value={counts ?? ""} last />
        </AccountGroup>
        <AccountGroup>
          <AccountRow label={t.account.terms} onPress={() => openLink(legalLinks.terms)} />
          <AccountRow label={t.account.privacy} onPress={() => openLink(legalLinks.privacy)} last />
        </AccountGroup>
        <AccountGroup>
          {registered ? (
            <AccountRow label={t.account.signOut} onPress={signOut} disabled={working} last />
          ) : (
            <AccountRow label={t.account.createAccount} onPress={() => router.push("/sign-in")} disabled={working} last />
          )}
        </AccountGroup>
        <AccountGroup>
          <AccountRow label={t.account.delete} onPress={askToDelete} disabled={working} danger last />
        </AccountGroup>
        <Text style={styles.note}>{t.account.deleteNote}</Text>
        {message === null ? null : <Text style={styles.error}>{message}</Text>}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  note: {
    ...typography.footnote,
    color: colors.inkSecondary,
    marginTop: -8,
    paddingHorizontal: 16,
  },
  error: {
    ...typography.interfaceSecondary,
    color: colors.danger,
    paddingHorizontal: 16,
  },
});
