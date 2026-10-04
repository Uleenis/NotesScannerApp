export type SupabaseConfig = { url: string; publishableKey: string };

type RawSupabaseConfig = { url: string | undefined; publishableKey: string | undefined };

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value.trim();
}

export function readSupabaseConfig(raw: RawSupabaseConfig): SupabaseConfig {
  return {
    url: required(raw.url, "EXPO_PUBLIC_SUPABASE_URL"),
    publishableKey: required(raw.publishableKey, "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}
