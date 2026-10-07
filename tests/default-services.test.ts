import { defaultAuthServices } from "@/auth/default-services";

type Callback = (event: string, session: { user: { id: string; email?: string; is_anonymous?: boolean } } | null) => void;

const mockUnsubscribe = jest.fn();
let mockCallback: Callback | null = null;
const mockOnAuthStateChange = jest.fn((callback: Callback) => {
  mockCallback = callback;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});

jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: { onAuthStateChange: mockOnAuthStateChange } }),
}));

beforeEach(() => {
  mockCallback = null;
  mockUnsubscribe.mockClear();
  mockOnAuthStateChange.mockClear();
});

function emit(event: string, session: Parameters<Callback>[1]) {
  if (mockCallback === null) {
    throw new Error("nothing is watching");
  }
  mockCallback(event, session);
}

test("announces the account of a sign-in, with its e-mail", () => {
  const listener = jest.fn();
  defaultAuthServices.watch(listener);

  emit("SIGNED_IN", { user: { id: "user-1", email: "reader@example.test", is_anonymous: false } });

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({ userId: "user-1", email: "reader@example.test", isAnonymous: false });
});

test("announces the end of the account at sign-out", () => {
  const listener = jest.fn();
  defaultAuthServices.watch(listener);

  emit("SIGNED_OUT", null);

  expect(listener).toHaveBeenCalledWith(null);
});

test("says nothing about events that do not change the account", () => {
  const listener = jest.fn();
  defaultAuthServices.watch(listener);

  emit("INITIAL_SESSION", { user: { id: "user-1" } });
  emit("PASSWORD_RECOVERY", { user: { id: "user-1" } });

  expect(listener).not.toHaveBeenCalled();
});

test("stops watching when told to", () => {
  const stop = defaultAuthServices.watch(jest.fn());
  expect(mockUnsubscribe).not.toHaveBeenCalled();

  stop();

  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

test("watches the client once per call", () => {
  defaultAuthServices.watch(jest.fn());
  defaultAuthServices.watch(jest.fn());

  expect(mockOnAuthStateChange).toHaveBeenCalledTimes(2);
});
