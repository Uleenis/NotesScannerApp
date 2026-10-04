import { readSupabaseConfig } from "@/lib/config";

test("returns the url and the publishable key when both are set", () => {
  expect(readSupabaseConfig({ url: "http://192.168.0.10:54321", publishableKey: "sb_publishable_x" })).toEqual({
    url: "http://192.168.0.10:54321",
    publishableKey: "sb_publishable_x",
  });
});

test.each([
  ["missing", undefined],
  ["empty", ""],
  ["blank", "   "],
])("refuses a %s url and names the variable", (_label, url) => {
  expect(() => readSupabaseConfig({ url, publishableKey: "sb_publishable_x" })).toThrow(
    "EXPO_PUBLIC_SUPABASE_URL",
  );
});

test.each([
  ["missing", undefined],
  ["empty", ""],
  ["blank", "   "],
])("refuses a %s publishable key and names the variable", (_label, publishableKey) => {
  expect(() => readSupabaseConfig({ url: "http://192.168.0.10:54321", publishableKey })).toThrow(
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
});
