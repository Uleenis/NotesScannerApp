import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";

import { ForgetOtherAccounts } from "@/components/forget-other-accounts";
import { forgetOtherAccounts } from "@/lib/query-client";

let mockUserId: string | null = "user-1";

jest.mock("@/auth/auth-provider", () => ({ useAuth: () => ({ userId: mockUserId }) }));

const KEYS = [
  ["pages", "user-1"],
  ["notebooks", "user-1"],
  ["notebook", "user-1", "n1"],
  ["allowance", "user-1"],
  ["latest-notebook", "user-1"],
  ["page", "user-1", "p1"],
  ["photo-url", "user-1", "p1"],
] as const;

const clients: QueryClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.clear();
  }
});

function filled(): QueryClient {
  const queryClient = new QueryClient();
  clients.push(queryClient);
  for (const key of KEYS) {
    queryClient.setQueryData([...key], "kept");
    queryClient.setQueryData([key[0], "user-2", ...key.slice(2)], "other");
  }
  queryClient.setQueryData(["unrelated", "user-2"], "unrelated");
  return queryClient;
}

function remaining(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey.join("/"))
    .sort();
}

test("removes the data of every other account and keeps the data of the current one", () => {
  const queryClient = filled();

  forgetOtherAccounts(queryClient, "user-1");

  expect(remaining(queryClient)).toEqual(
    [...KEYS.map((key) => key.join("/")), "unrelated/user-2"].sort(),
  );
});

test("removes the data of every account while there is no account", () => {
  const queryClient = filled();

  forgetOtherAccounts(queryClient, null);

  expect(remaining(queryClient)).toEqual(["unrelated/user-2"]);
});

test("keeps what does not belong to an account", () => {
  const queryClient = new QueryClient();
  clients.push(queryClient);
  queryClient.setQueryData(["unrelated", "user-2"], "unrelated");

  forgetOtherAccounts(queryClient, "user-1");

  expect(remaining(queryClient)).toEqual(["unrelated/user-2"]);
});

test("forgets the previous account as soon as the account changes", async () => {
  const queryClient = filled();
  mockUserId = "user-1";
  const view = await render(
    <QueryClientProvider client={queryClient}>
      <ForgetOtherAccounts />
    </QueryClientProvider>,
  );
  expect(remaining(queryClient)).not.toContain("pages/user-2");

  queryClient.setQueryData(["pages", "user-2"], "other");
  mockUserId = "user-2";
  await view.rerender(
    <QueryClientProvider client={queryClient}>
      <ForgetOtherAccounts />
    </QueryClientProvider>,
  );

  expect(remaining(queryClient)).toContain("pages/user-2");
  expect(remaining(queryClient)).not.toContain("pages/user-1");
});

test("keeps the data when the same account becomes registered", async () => {
  const queryClient = filled();
  mockUserId = "user-1";
  const view = await render(
    <QueryClientProvider client={queryClient}>
      <ForgetOtherAccounts />
    </QueryClientProvider>,
  );
  await view.rerender(
    <QueryClientProvider client={queryClient}>
      <ForgetOtherAccounts />
    </QueryClientProvider>,
  );

  expect(remaining(queryClient)).toContain("pages/user-1");
});
