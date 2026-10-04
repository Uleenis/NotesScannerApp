import { Stack } from "expo-router";

import { stackScreenOptions } from "@/navigation-options";

export const unstable_settings = { anchor: "index" };

export default function SignInLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}
