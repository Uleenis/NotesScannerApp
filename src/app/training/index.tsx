import { useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { AccountGroup } from "@/components/account/account-group";
import { AccountRow } from "@/components/account/account-row";
import { HeaderTextButton } from "@/components/header-text-button";
import { LoadError } from "@/components/load-error";
import { PrimaryButton } from "@/components/primary-button";
import { trainingStyles } from "@/components/training/styles";
import { useStrings } from "@/i18n";
import { colors } from "@/theme";
import { refreshTraining, useTrainingState } from "@/training/queries";
import { trainingService } from "@/training/service";

export default function TrainingScreen() {
  const t = useStrings();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const training = useTrainingState();
  const [withdrawing, setWithdrawing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);

  const registered = auth.status === "ready" && !auth.isAnonymous;

  function close() {
    router.dismissAll();
    router.dismiss();
  }

  async function withdraw() {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setWithdrawing(true);
    setProblem(null);
    try {
      const outcome = await trainingService.revoke();
      if (outcome.ok) {
        await refreshTraining(queryClient, auth.userId);
      } else {
        setProblem(outcome.reason === "offline" ? t.training.errors.offline : t.training.errors.failed);
      }
    } finally {
      busy.current = false;
      setWithdrawing(false);
    }
  }

  function askToWithdraw() {
    if (busy.current) {
      return;
    }
    Alert.alert(t.training.withdrawConfirmTitle, t.training.withdrawConfirmBody, [
      { text: t.common.cancel, style: "cancel" },
      { text: t.training.withdrawConfirm, style: "destructive", onPress: () => void withdraw() },
    ]);
  }

  const header = (
    <Stack.Screen options={{ title: t.training.title, headerRight: () => <HeaderTextButton label={t.common.done} onPress={close} /> }} />
  );

  if (!registered) {
    return (
      <>
        {header}
        <ScrollView contentContainerStyle={trainingStyles.content}>
          <Text style={trainingStyles.body}>{t.training.registeredOnly}</Text>
        </ScrollView>
      </>
    );
  }

  if (training.isError) {
    return (
      <>
        {header}
        <LoadError message={t.training.loadFailed} onRetry={() => void training.refetch()} />
      </>
    );
  }

  const state = training.data;
  if (state === undefined) {
    return (
      <>
        {header}
        <View style={styles.loading}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView contentContainerStyle={trainingStyles.content}>
        {state.consent === "none" ? (
          <>
            <Text style={trainingStyles.body}>{t.training.intro}</Text>
            <PrimaryButton
              label={t.training.start}
              onPress={() => router.push(state.birthYear === null ? "/training/age" : "/training/consent")}
            />
            {state.birthYear === null ? null : (
              <Text accessibilityRole="link" onPress={() => router.push("/training/code")} style={trainingStyles.link}>
                {t.training.haveCode}
              </Text>
            )}
          </>
        ) : (
          <>
            <Text style={trainingStyles.body}>{state.consent === "parent" ? t.training.byParent : t.training.byYou}</Text>
            <AccountGroup>
              <AccountRow label={t.training.writing.row} onPress={() => router.push("/training/writing-test")} />
              <AccountRow label={t.training.withdraw} onPress={askToWithdraw} disabled={withdrawing} danger last />
            </AccountGroup>
            <Text style={trainingStyles.note}>{t.training.withdrawNote}</Text>
            {problem === null ? null : <Text style={trainingStyles.error}>{problem}</Text>}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
