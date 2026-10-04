import type { Language } from "@/i18n";

export type ProfileClient = {
  from: (table: "profiles") => {
    update: (values: { interface_language: Language }) => {
      eq: (column: "id", value: string) => PromiseLike<{ error: unknown }>;
    };
  };
};

export async function syncInterfaceLanguage(
  client: ProfileClient,
  userId: string,
  language: Language,
): Promise<boolean> {
  try {
    const { error } = await client.from("profiles").update({ interface_language: language }).eq("id", userId);
    return !error;
  } catch {
    return false;
  }
}
