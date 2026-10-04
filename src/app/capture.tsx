import { Stack, router } from "expo-router";

import { HeaderTextButton } from "@/components/header-text-button";
import { ScreenPlaceholder } from "@/components/screen-placeholder";
import { useStrings } from "@/i18n";

export default function CaptureScreen() {
  const t = useStrings();

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => <HeaderTextButton label={t.common.cancel} onPress={() => router.back()} />,
        }}
      />
      <ScreenPlaceholder label={t.shell.capture} />
    </>
  );
}
