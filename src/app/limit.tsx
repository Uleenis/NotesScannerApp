import { Redirect, router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { SecondaryButton } from "@/components/secondary-button";
import { FREE_MONTHLY_PAGES, TRIAL_PAGES } from "@/capture/allowance";
import { readLimitParams } from "@/capture/limit-route";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

export default function LimitSheet() {
  const t = useStrings();
  const block = readLimitParams(useLocalSearchParams<{ kind: string; max: string; month: string }>());

  if (block === null) {
    return <Redirect href="/" />;
  }

  function createAccount() {
    router.replace("/sign-in");
  }

  const title = block.kind === "month" ? t.limit.monthTitle(block.max) : t.limit.accountTitle;
  const body = block.kind === "month" ? t.limit.monthBody(block.resetMonth) : block.kind === "trial" ? t.limit.trialBody(TRIAL_PAGES, FREE_MONTHLY_PAGES) : t.limit.dailyBody;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.buttons}>
        {block.kind === "month" ? (
          <PrimaryButton label={t.limit.understood} onPress={() => router.back()} />
        ) : (
          <>
            <PrimaryButton label={t.limit.createAccount} onPress={createAccount} />
            <SecondaryButton label={t.limit.later} onPress={() => router.back()} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 32,
  },
  title: {
    ...typography.pageTitle,
    color: colors.ink,
  },
  body: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    paddingBottom: 24,
  },
  buttons: {
    gap: 12,
  },
});
