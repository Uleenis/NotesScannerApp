import { act, render, screen } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import { StrictMode } from "react";
import { AppState, type AppStateStatus, Text } from "react-native";

import { AuthProvider, useAuth, type AuthServices } from "@/auth/auth-provider";
import type { AuthResult } from "@/auth/session";
import { createSessionManager } from "@/auth/session";
import { created, fakeAuthClient, noSession } from "./fake-auth-client";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));

const READY: AuthResult = { status: "ready", userId: "user-1" };
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

function fakeServices(...results: AuthResult[]) {
  const ensureSession = jest.fn<Promise<AuthResult>, []>();
  for (const result of results) {
    ensureSession.mockResolvedValueOnce(result);
  }
  ensureSession.mockResolvedValue(results[results.length - 1] ?? UNAVAILABLE);
  const syncLanguage = jest.fn<Promise<boolean>, [string, "en" | "fr"]>().mockResolvedValue(true);
  const services: AuthServices = { ensureSession, syncLanguage };
  return { services, ensureSession, syncLanguage };
}

function Probe() {
  const { status, userId } = useAuth();
  return <Text testID="auth">{`${status}:${userId ?? "none"}`}</Text>;
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

function mount(services: AuthServices) {
  return render(
    <AuthProvider services={services}>
      <Probe />
      <Text testID="content">content</Text>
    </AuthProvider>,
  );
}

test("is loading first, then ready with the account", async () => {
  const { services } = fakeServices(READY);
  mount(services);

  expect(screen.getByTestId("auth").props.children).toBe("loading:none");
  await flush();
  expect(screen.getByTestId("auth").props.children).toBe("ready:user-1");
});

test("writes the language of the phone into the profile of the account", async () => {
  const { services, syncLanguage } = fakeServices(READY);
  mount(services);
  await flush();

  expect(syncLanguage).toHaveBeenCalledWith("user-1", "fr");
});

test("writes the new language when the phone language changes", async () => {
  const { services, syncLanguage } = fakeServices(READY);
  const { rerender } = mount(services);
  await flush();

  jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  rerender(
    <AuthProvider services={services}>
      <Probe />
    </AuthProvider>,
  );
  await flush();

  expect(syncLanguage).toHaveBeenLastCalledWith("user-1", "en");
});

test("does not write a language while there is no account", async () => {
  const { services, syncLanguage } = fakeServices(UNAVAILABLE);
  mount(services);
  await flush();

  expect(syncLanguage).not.toHaveBeenCalled();
});

test("shows the app while loading and while the account is unavailable", async () => {
  const { services } = fakeServices(UNAVAILABLE);
  mount(services);
  expect(screen.getByTestId("content")).toBeTruthy();

  await flush();
  expect(screen.getByTestId("auth").props.children).toBe("unavailable:none");
  expect(screen.getByTestId("content")).toBeTruthy();
});

test("tries again by itself after a failure and becomes ready", async () => {
  const { services, ensureSession } = fakeServices(UNAVAILABLE, READY);
  mount(services);
  await flush();
  expect(screen.getByTestId("auth").props.children).toBe("unavailable:none");

  await advance(2000);

  expect(ensureSession).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("auth").props.children).toBe("ready:user-1");
});

test("waits 2, 4, 8 then 30 seconds between attempts", async () => {
  const { services, ensureSession } = fakeServices(UNAVAILABLE);
  mount(services);
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
  mount(services);
  await flush();
  await advance(2000);
  await advance(120000);

  expect(ensureSession).toHaveBeenCalledTimes(2);
});

test("tries again when the app comes back to the foreground", async () => {
  const { services, ensureSession } = fakeServices(UNAVAILABLE, READY);
  mount(services);
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
  mount(services);
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
  const view = mount(services);
  await flush();

  view.unmount();
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
  };

  render(
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
