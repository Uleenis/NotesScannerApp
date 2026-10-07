import { act, render, screen } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import { StrictMode } from "react";
import { AppState, type AppStateStatus, Text } from "react-native";

import { AuthProvider, useAuth, type AuthServices } from "@/auth/auth-provider";
import type { AccountChange, AuthResult } from "@/auth/session";
import { createSessionManager } from "@/auth/session";
import { created, deferred, fakeAuthClient, noSession } from "./fake-auth-client";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));

const READY: AuthResult = { status: "ready", userId: "user-1", email: null, isAnonymous: true };
const UNAVAILABLE: AuthResult = { status: "unavailable" };

let appStateListeners: ((state: AppStateStatus) => void)[] = [];
let removeListener: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  appStateListeners = [];
  removeListener = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return { remove: removeListener };
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function fakeWatch() {
  const listeners: ((change: AccountChange) => void)[] = [];
  const unsubscribe = jest.fn();
  const watch = jest.fn((listener: (change: AccountChange) => void) => {
    listeners.push(listener);
    return unsubscribe;
  });
  const emit = (change: AccountChange) => {
    for (const listener of listeners) {
      listener(change);
    }
  };
  return { watch, emit, unsubscribe };
}

function fakeServices(...results: AuthResult[]) {
  const ensureSession = jest.fn<Promise<AuthResult>, []>();
  for (const result of results) {
    ensureSession.mockResolvedValueOnce(result);
  }
  ensureSession.mockResolvedValue(results[results.length - 1] ?? UNAVAILABLE);
  const syncLanguage = jest.fn<Promise<boolean>, [string, "en" | "fr"]>().mockResolvedValue(true);
  const watching = fakeWatch();
  const services: AuthServices = { ensureSession, syncLanguage, watch: watching.watch };
  return { services, ensureSession, syncLanguage, ...watching };
}

function Probe() {
  const { status, userId } = useAuth();
  return <Text testID="auth">{`${status}:${userId ?? "none"}`}</Text>;
}

function DetailsProbe() {
  const auth = useAuth();
  return <Text testID="details">{auth.status === "ready" ? `${auth.email ?? "no-email"}:${auth.isAnonymous ? "anonymous" : "registered"}` : "none"}</Text>;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
  });
}

async function mount(services: AuthServices) {
  return await render(
    <AuthProvider services={services}>
      <Probe />
      <DetailsProbe />
      <Text testID="content">content</Text>
    </AuthProvider>,
  );
}

test("is loading first, then ready with the account", async () => {
  const { services, ensureSession } = fakeServices(READY);
  const pending = deferred<AuthResult>();
  ensureSession.mockReset().mockReturnValue(pending.promise);
  await mount(services);

  expect(screen.getByTestId("auth").props.children).toBe("loading:none");
  expect(screen.getByTestId("content")).toBeTruthy();

  pending.resolve(READY);
  await flush();
  expect(screen.getByTestId("auth").props.children).toBe("ready:user-1");
});

test("writes the language of the phone into the profile of the account", async () => {
  const { services, syncLanguage } = fakeServices(READY);
  await mount(services);
  await flush();

  expect(syncLanguage).toHaveBeenCalledWith("user-1", "fr");
});

test("writes the new language when the phone language changes", async () => {
  const { services, syncLanguage } = fakeServices(READY);
  const { rerender } = await mount(services);
  await flush();

  jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  await rerender(
    <AuthProvider services={services}>
      <Probe />
    </AuthProvider>,
  );
  await flush();

  expect(syncLanguage).toHaveBeenLastCalledWith("user-1", "en");
});

test("does not write a language while there is no account", async () => {
  const { services, syncLanguage } = fakeServices(UNAVAILABLE);
  await mount(services);
  await flush();

  expect(syncLanguage).not.toHaveBeenCalled();
});

test("shows the app while loading and while the account is unavailable", async () => {
  const { services } = fakeServices(UNAVAILABLE);
  await mount(services);
  expect(screen.getByTestId("content")).toBeTruthy();

  await flush();
  expect(screen.getByTestId("auth").props.children).toBe("unavailable:none");
  expect(screen.getByTestId("content")).toBeTruthy();
});

test("tries again by itself after a failure and becomes ready", async () => {
  const { services, ensureSession } = fakeServices(UNAVAILABLE, READY);
  await mount(services);
  await flush();
  expect(screen.getByTestId("auth").props.children).toBe("unavailable:none");

  await advance(2000);

  expect(ensureSession).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("auth").props.children).toBe("ready:user-1");
});

test("waits 2, 4, 8 then 30 seconds between attempts", async () => {
  const { services, ensureSession } = fakeServices(UNAVAILABLE);
  await mount(services);
  await flush();
  expect(ensureSession).toHaveBeenCalledTimes(1);

  await advance(1999);
  expect(ensureSession).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(ensureSession).toHaveBeenCalledTimes(2);

  await advance(3999);
  expect(ensureSession).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(ensureSession).toHaveBeenCalledTimes(3);

  await advance(7999);
  expect(ensureSession).toHaveBeenCalledTimes(3);
  await advance(1);
  expect(ensureSession).toHaveBeenCalledTimes(4);

  await advance(29999);
  expect(ensureSession).toHaveBeenCalledTimes(4);
  await advance(1);
  expect(ensureSession).toHaveBeenCalledTimes(5);

  await advance(30000);
  expect(ensureSession).toHaveBeenCalledTimes(6);
});

test("stops trying once the account is ready", async () => {
  const { services, ensureSession } = fakeServices(UNAVAILABLE, READY);
  await mount(services);
  await flush();
  await advance(2000);
  await advance(120000);

  expect(ensureSession).toHaveBeenCalledTimes(2);
});

test("tries again when the app comes back to the foreground", async () => {
  const { services, ensureSession } = fakeServices(UNAVAILABLE, READY);
  await mount(services);
  await flush();
  expect(ensureSession).toHaveBeenCalledTimes(1);

  await act(async () => {
    for (const listener of appStateListeners) {
      listener("active");
    }
  });

  expect(ensureSession).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("auth").props.children).toBe("ready:user-1");
});

test("does not try again on a return to the foreground once the account is ready", async () => {
  const { services, ensureSession } = fakeServices(READY);
  await mount(services);
  await flush();

  await act(async () => {
    for (const listener of appStateListeners) {
      listener("active");
    }
  });

  expect(ensureSession).toHaveBeenCalledTimes(1);
});

test("stops trying after the app is closed", async () => {
  const { services, ensureSession } = fakeServices(UNAVAILABLE);
  const view = await mount(services);
  await flush();

  await view.unmount();
  await advance(120000);

  expect(ensureSession).toHaveBeenCalledTimes(1);
  expect(removeListener).toHaveBeenCalled();
});

test("creates one account even when the app renders twice in strict mode", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(noSession());
  signInAnonymously.mockResolvedValue(created("only-user"));
  const manager = createSessionManager(client);
  const services: AuthServices = {
    ensureSession: manager.ensureSession,
    syncLanguage: jest.fn().mockResolvedValue(true),
    watch: fakeWatch().watch,
  };

  await render(
    <StrictMode>
      <AuthProvider services={services}>
        <Probe />
      </AuthProvider>
    </StrictMode>,
  );
  await flush();
  await flush();

  expect(signInAnonymously).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("auth").props.children).toBe("ready:only-user");
});

const REGISTERED: AccountChange = { userId: "user-1", email: "reader@example.test", isAnonymous: false };

test("shows the e-mail and the kind of the account", async () => {
  const { services } = fakeServices({ status: "ready", userId: "user-1", email: null, isAnonymous: true });
  await mount(services);
  await flush();

  expect(screen.getByTestId("details").props.children).toBe("no-email:anonymous");
});

test("follows the sign-up of the account: same identifier, now registered, with its e-mail", async () => {
  const { services, emit } = fakeServices(READY);
  await mount(services);
  await flush();

  await act(async () => emit(REGISTERED));

  expect(screen.getByTestId("auth").props.children).toBe("ready:user-1");
  expect(screen.getByTestId("details").props.children).toBe("reader@example.test:registered");
});

test("follows a sign-in to another account", async () => {
  const { services, emit } = fakeServices(READY);
  await mount(services);
  await flush();

  await act(async () => emit({ userId: "user-2", email: "other@example.test", isAnonymous: false }));

  expect(screen.getByTestId("auth").props.children).toBe("ready:user-2");
  expect(screen.getByTestId("details").props.children).toBe("other@example.test:registered");
});

test("writes the language of the phone into the profile of the account found at sign-in", async () => {
  const { services, syncLanguage, emit } = fakeServices(READY);
  await mount(services);
  await flush();
  syncLanguage.mockClear();

  await act(async () => emit({ userId: "user-2", email: "other@example.test", isAnonymous: false }));
  await flush();

  expect(syncLanguage).toHaveBeenCalledTimes(1);
  expect(syncLanguage).toHaveBeenCalledWith("user-2", "fr");
});

test("does not write the language again when the account does not change", async () => {
  const { services, syncLanguage, emit } = fakeServices(READY);
  await mount(services);
  await flush();
  syncLanguage.mockClear();

  await act(async () => emit(REGISTERED));
  await act(async () => emit(REGISTERED));
  await flush();

  expect(syncLanguage).not.toHaveBeenCalled();
});

test("goes back to loading at sign-out, then opens a new anonymous account", async () => {
  const { services, ensureSession, emit } = fakeServices(READY);
  await mount(services);
  await flush();
  const next = deferred<AuthResult>();
  ensureSession.mockReset().mockReturnValue(next.promise);

  await act(async () => emit(null));
  expect(screen.getByTestId("auth").props.children).toBe("loading:none");
  expect(ensureSession).toHaveBeenCalledTimes(1);

  next.resolve({ status: "ready", userId: "user-2", email: null, isAnonymous: true });
  await flush();
  expect(screen.getByTestId("auth").props.children).toBe("ready:user-2");
  expect(screen.getByTestId("details").props.children).toBe("no-email:anonymous");
});

test("tries again after sign-out when the new account cannot be opened at once", async () => {
  const { services, ensureSession, emit } = fakeServices(READY);
  await mount(services);
  await flush();
  ensureSession
    .mockReset()
    .mockResolvedValueOnce(UNAVAILABLE)
    .mockResolvedValue({ status: "ready", userId: "user-2", email: null, isAnonymous: true });

  await act(async () => emit(null));
  await flush();
  expect(screen.getByTestId("auth").props.children).toBe("unavailable:none");

  await advance(2000);
  expect(screen.getByTestId("auth").props.children).toBe("ready:user-2");
});

test("does not rebuild the state when the same account is announced again", async () => {
  const { services, emit } = fakeServices(READY);
  const renders = jest.fn();
  function Counting() {
    renders(useAuth());
    return null;
  }
  await render(
    <AuthProvider services={services}>
      <Counting />
    </AuthProvider>,
  );
  await flush();
  await act(async () => emit({ userId: "user-1", email: null, isAnonymous: true }));
  const before = renders.mock.calls.length;

  await act(async () => emit({ userId: "user-1", email: null, isAnonymous: true }));

  expect(renders.mock.calls.length).toBe(before);
});

test("stops watching the account when the app is closed", async () => {
  const { services, unsubscribe } = fakeServices(READY);
  const view = await mount(services);
  await flush();

  await view.unmount();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("ignores a change announced after the app is closed", async () => {
  const { services, emit, ensureSession } = fakeServices(READY);
  const view = await mount(services);
  await flush();
  await view.unmount();

  await act(async () => emit(null));

  expect(ensureSession).toHaveBeenCalledTimes(1);
});
