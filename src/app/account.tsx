import { Stack, router } from "expo-router";

import { HeaderTextButton } from "@/components/header-text-button";
import { ScreenPlaceholder } from "@/components/screen-placeholder";
import { useStrings } from "@/i18n";

export default function AccountScreen() {
  const t = useStrings();

  return (
    <>
      <Stack.Screen
        options={{
          title: t.account.title,
          headerLargeTitleEnabled: true,
          headerRight: () => <HeaderTextButton label={t.common.done} onPress={() => router.back()} />,
        }}
      />
      <ScreenPlaceholder label={t.account.title} />
    </>
  );
}
