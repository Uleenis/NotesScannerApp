import { useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { useLocales } from "expo-localization";
import { useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { PrimaryButton } from "@/components/primary-button";
import { trainingStyles as styles } from "@/components/training/styles";
import { useStrings } from "@/i18n";
import { colors } from "@/theme";
import { countryFromRegion, parisYear, parseBirthYear } from "@/training/age";
import { refreshTraining } from "@/training/queries";
import { trainingService } from "@/training/service";

export default function AgeScreen() {
  const t = useStrings();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const locales = useLocales();
  const [year, setYear] = useState("");
  const [focused, setFocused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  function edit(text: string) {
    setYear(text);
    setProblem(null);
  }

  async function save() {
    const userId = auth.userId;
    if (busy.current || userId === null) {
      return;
    }
    const birthYear = parseBirthYear(year, parisYear(new Date()));
    if (birthYear === null) {
      setProblem(t.training.errors.invalidYear);
      return;
    }
    busy.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const outcome = await trainingService.saveAge(userId, birthYear, countryFromRegion(locales[0]?.regionCode));
      if (outcome.ok || outcome.reason === "already_set") {
        void refreshTraining(queryClient, userId);
        router.replace("/training/consent");
        return;
      }
      setProblem(
        outcome.reason === "out_of_range"
          ? t.training.errors.invalidYear
          : outcome.reason === "not_registered"
            ? t.training.errors.notRegistered
            : outcome.reason === "offline"
              ? t.training.errors.offline
              : t.training.errors.failed,
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t.common.back }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t.training.ageTitle}</Text>
        <Text style={styles.body}>{t.training.ageBody}</Text>
        <TextInput
          accessibilityLabel={t.training.ageLabel}
          autoFocus
          keyboardType="number-pad"
          maxLength={4}
          onBlur={() => setFocused(false)}
          onChangeText={edit}
          onFocus={() => setFocused(true)}
          onSubmitEditing={() => void save()}
          placeholder={t.training.agePlaceholder}
          placeholderTextColor={colors.inkTertiary}
          returnKeyType="done"
          style={[styles.field, focused && styles.fieldFocused]}
          value={year}
        />
        {problem === null ? null : <Text style={styles.error}>{problem}</Text>}
        <View style={styles.button}>
          <PrimaryButton label={t.training.ageContinue} onPress={() => void save()} disabled={saving} />
        </View>
      </ScrollView>
    </>
  );
}
