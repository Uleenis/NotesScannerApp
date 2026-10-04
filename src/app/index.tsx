import { Stack } from "expo-router";

import { ShellIndex } from "@/components/shell-index";
import { useStrings } from "@/i18n";

export default function LibraryScreen() {
  const t = useStrings();

  return (
    <>
      <Stack.Screen options={{ title: t.library.title, headerLargeTitleEnabled: true }} />
      <ShellIndex />
    </>
  );
}
