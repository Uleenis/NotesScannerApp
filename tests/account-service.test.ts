import { accountService } from "@/auth/account-service";
import { pageService } from "@/pages/service";

const mockMain = {
  auth: {
    getSession: jest.fn(),
    getUser: jest.fn(),
    updateUser: jest.fn(),
    signInWithOtp: jest.fn(),
    verifyOtp: jest.fn(),
    setSession: jest.fn(),
    signOut: jest.fn(),
  },
  functions: { invoke: jest.fn() },
};

const mockStateless = { auth: { verifyOtp: jest.fn() } };

jest.mock("@/lib/supabase", () => ({
  getSupabase: () => mockMain,
  getStatelessSupabase: () => mockStateless,
}));
jest.mock("@/pages/service", () => ({ pageService: { count: jest.fn() } }));

const FOUND = { data: { session: { access_token: "found-access", refresh_token: "found-refresh", user: { id: "found-user" } } }, error: null };

beforeEach(() => {
  for (const group of [mockMain.auth, mockMain.functions, mockStateless.auth]) {
    for (const fn of Object.values(group)) {
      fn.mockReset();
    }
  }
  mockMain.auth.getSession.mockResolvedValue({ data: { session: { access_token: "anonymous-access" } }, error: null });
  mockMain.auth.verifyOtp.mockResolvedValue({ error: null });
  mockMain.auth.setSession.mockResolvedValue({ error: null });
  mockMain.functions.invoke.mockResolvedValue({ error: null });
  mockStateless.auth.verifyOtp.mockResolvedValue(FOUND);
  jest.mocked(pageService.count).mockReset().mockResolvedValue(2);
});

test("checks the code of a sign-in from an anonymous account with pages on the client that keeps nothing", async () => {
  const result = await accountService.confirmSignIn("reader@example.test", "123456", true);

  expect(result).toEqual({
    ok: true,
    transfer: { pages: 2, session: { accessToken: "found-access", refreshToken: "found-refresh", userId: "found-user" } },
  });
  expect(mockStateless.auth.verifyOtp).toHaveBeenCalledWith({ email: "reader@example.test", token: "123456", type: "email" });
  expect(mockMain.auth.verifyOtp).not.toHaveBeenCalled();
  expect(mockMain.auth.setSession).not.toHaveBeenCalled();
});

test("checks the code of a sign-in from an anonymous account without pages on the client of the phone", async () => {
  jest.mocked(pageService.count).mockResolvedValue(0);

  expect(await accountService.confirmSignIn("reader@example.test", "123456", true)).toEqual({ ok: true, transfer: null });

  expect(mockMain.auth.verifyOtp).toHaveBeenCalledWith({ email: "reader@example.test", token: "123456", type: "email" });
  expect(mockStateless.auth.verifyOtp).not.toHaveBeenCalled();
});

test("asks the transfer on the client of the phone with both tokens, then gives the account found to that client", async () => {
  const pending = { pages: 2, session: { accessToken: "found-access", refreshToken: "found-refresh", userId: "found-user" } };

  expect(await accountService.completeTransfer(pending)).toEqual({ ok: true, userId: "found-user" });

  expect(mockMain.functions.invoke).toHaveBeenCalledWith("transfer-account", {
    headers: { Authorization: "Bearer anonymous-access", "x-account-token": "found-access" },
  });
  expect(mockMain.auth.setSession).toHaveBeenCalledWith({ access_token: "found-access", refresh_token: "found-refresh" });
});

test("does not give the account found to the client of the phone when the transfer fails", async () => {
  mockMain.functions.invoke.mockResolvedValue({ error: Object.assign(new Error("failed"), { name: "FunctionsHttpError", context: { status: 409 } }) });
  const pending = { pages: 2, session: { accessToken: "found-access", refreshToken: "found-refresh", userId: "found-user" } };

  expect(await accountService.completeTransfer(pending)).toEqual({ ok: false, reason: "reading_in_progress" });

  expect(mockMain.auth.setSession).not.toHaveBeenCalled();
});

test("still asks for a sign-in code without the account being anonymous or not", async () => {
  mockMain.auth.signInWithOtp.mockResolvedValue({ error: null });

  expect(await accountService.startSignIn("reader@example.test")).toEqual({ ok: true });

  expect(mockMain.auth.signInWithOtp).toHaveBeenCalledWith({ email: "reader@example.test", options: { shouldCreateUser: false } });
});
