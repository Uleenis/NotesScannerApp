import { syncInterfaceLanguage, type ProfileClient } from "@/auth/profile-language";

type Update = { table: string; values: object; column: string; value: string };

function fakeProfileClient(outcome: "ok" | "error" | "throws") {
  const updates: Update[] = [];
  const client: ProfileClient = {
    from: (table) => ({
      update: (values) => ({
        eq: async (column, value) => {
          updates.push({ table, values, column, value });
          if (outcome === "throws") {
            throw new TypeError("Network request failed");
          }
          return { error: outcome === "error" ? new Error("denied") : null };
        },
      }),
    }),
  };
  return { client, updates };
}

test.each(["en", "fr"] as const)("writes %s into the profile of the user, and nothing else", async (language) => {
  const { client, updates } = fakeProfileClient("ok");

  expect(await syncInterfaceLanguage(client, "user-1", language)).toBe(true);

  expect(updates).toEqual([
    { table: "profiles", values: { interface_language: language }, column: "id", value: "user-1" },
  ]);
});

test("answers false when the database refuses the write", async () => {
  const { client } = fakeProfileClient("error");

  expect(await syncInterfaceLanguage(client, "user-1", "fr")).toBe(false);
});

test("answers false when the network call throws", async () => {
  const { client } = fakeProfileClient("throws");

  expect(await syncInterfaceLanguage(client, "user-1", "fr")).toBe(false);
});
