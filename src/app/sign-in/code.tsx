import { Stack } from "expo-router";

import { ScreenPlaceholder } from "@/components/screen-placeholder";
import { useStrings } from "@/i18n";

export default function CodeScreen() {
  const t = useStrings();

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t.common.back }} />
      <ScreenPlaceholder label={t.shell.code} />
    </>
  );
}
