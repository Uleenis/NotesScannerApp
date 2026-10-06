import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { Allowance } from "@/capture/allowance";
import { freshAllowance, useLatestNotebookId } from "@/capture/queries";
import { captureService } from "@/capture/service";

jest.mock("@/auth/auth-provider", () => ({ useAuth: () => ({ status: "ready", userId: "user-1" }) }));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: null, blockedReason: null };
const blocked: Allowance = { ...open, used: 15, remaining: 0, blockedReason: "monthly_limit" };

const KEY = ["allowance", "user-1"];

afterEach(() => {
  jest.useRealTimers();
});

test("the last notebook is asked once: a failure is not tried again, the first notebook will do", async () => {
  jest.useFakeTimers();
  jest.mocked(captureService.latestNotebookId).mockReset().mockRejectedValue(new Error("offline"));
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = await renderHook(() => useLatestNotebookId(), { wrapper });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10000);
  });

  expect(captureService.latestNotebookId).toHaveBeenCalledTimes(1);
  expect(hook.result.current.isPending).toBe(false);
  expect(hook.result.current.isLoading).toBe(false);
});

test("the limits are read from the server even when the ones in memory are recent", async () => {
  const client = new QueryClient();
  client.setQueryData(KEY, open);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(blocked);

  expect(await freshAllowance(client, "user-1")).toEqual(blocked);
  expect(client.getQueryData(KEY)).toEqual(blocked);
});

test("when the server cannot be asked the limits in memory are given", async () => {
  const client = new QueryClient();
  client.setQueryData(KEY, blocked);
  jest.mocked(captureService.allowance).mockReset().mockRejectedValue(new Error("offline"));

  expect(await freshAllowance(client, "user-1")).toEqual(blocked);
});

test("when nothing is known and the server cannot be asked there are no limits", async () => {
  jest.mocked(captureService.allowance).mockReset().mockRejectedValue(new Error("offline"));

  expect(await freshAllowance(new QueryClient(), "user-1")).toBeUndefined();
});

test("when the server does not answer the limits in memory are given after a short wait, with no timer left", async () => {
  jest.useFakeTimers();
  const client = new QueryClient();
  client.setQueryData(KEY, blocked);
  jest.mocked(captureService.allowance).mockReset().mockReturnValue(new Promise(() => {}));
  const asking = freshAllowance(client, "user-1");
  await jest.advanceTimersByTimeAsync(3000);

  expect(await asking).toEqual(blocked);
});

test("an answer in time leaves no timer behind", async () => {
  jest.useFakeTimers();
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(open);
  await freshAllowance(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), "user-1");

  expect(jest.getTimerCount()).toBe(0);
});
