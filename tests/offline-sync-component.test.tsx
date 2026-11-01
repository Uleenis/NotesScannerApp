import { render } from "@testing-library/react-native";
import { AppState } from "react-native";

import { OfflineSync } from "@/components/offline-sync";

import { USER } from "./offline-fixtures";

const mockSession = {
  start: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
  foreground: jest.fn(async () => undefined),
  network: jest.fn(async () => undefined),
};
let mockDeps: { sync: (store: { userId: string }) => Promise<unknown>; isOnline: () => boolean } | null = null;
let mockAuth: { status: string; userId: string | null } = { status: "ready", userId: USER };
let mockNetwork: { isConnected?: boolean; type?: string } = { isConnected: true, type: "WIFI" };

jest.mock("@/auth/auth-provider", () => ({ useAuth: () => mockAuth }));
jest.mock("expo-network", () => ({ useNetworkState: () => mockNetwork }));
jest.mock("@/offline/session", () => ({
  createOfflineSession: (deps: typeof mockDeps) => {
    mockDeps = deps;
    return mockSession;
  },
}));
const mockIdentity = jest.fn();
jest.mock("@/offline/mirror", () => ({ setMirrorStore: jest.fn(), setMirrorIdentity: (...args: unknown[]) => mockIdentity(...args) }));
jest.mock("@/offline/store", () => ({ openAccountStore: jest.fn() }));
const mockSyncStore = jest.fn(async () => ({ status: "done", downloaded: 0 }));
jest.mock("@/offline/sync", () => ({ syncStore: (...args: unknown[]) => mockSyncStore(...(args as [])) }));
const mockDefaultDeps = jest.fn((userId: string, canDownload: () => boolean) => ({ userId, canDownload }));
jest.mock("@/offline/default-sync", () => ({
  defaultSyncDeps: (userId: string, canDownload: () => boolean) => mockDefaultDeps(userId, canDownload),
  signedInUser: async () => mockAuth.userId,
}));

let appStateHandler: ((state: string) => void) | null = null;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { status: "ready", userId: USER };
  mockNetwork = { isConnected: true, type: "WIFI" };
  appStateHandler = null;
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_event: string, handler: (state: string) => void) => {
    appStateHandler = handler;
    return { remove };
  }) as unknown as typeof AppState.addEventListener);
});

describe("the offline session of the app", () => {
  it("starts with the signed-in account and stops with the app", async () => {
    const view = await render(<OfflineSync />);
    expect(mockSession.start).toHaveBeenCalledWith(USER);
    await view.unmount();
    expect(mockSession.stop).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it("checks the account that is signed in before anything is written, and stops checking with the app", async () => {
    const view = await render(<OfflineSync />);
    const read = mockIdentity.mock.calls[0][0] as () => Promise<string | null>;
    await expect(read()).resolves.toBe(USER);
    await view.unmount();
    expect(mockIdentity).toHaveBeenLastCalledWith(null);
  });

  it("starts with nobody while the account is not ready", async () => {
    mockAuth = { status: "loading", userId: null };
    await render(<OfflineSync />);
    expect(mockSession.start).toHaveBeenCalledWith(null);
  });

  it("follows a change of account", async () => {
    const view = await render(<OfflineSync />);
    mockAuth = { status: "ready", userId: "7d2e4f6a-8b1c-4d3e-a5f7-9b1d3f5a7c9e" };
    await view.rerender(<OfflineSync />);
    expect(mockSession.start).toHaveBeenLastCalledWith("7d2e4f6a-8b1c-4d3e-a5f7-9b1d3f5a7c9e");
  });

  it("tells the session about the return to the foreground", async () => {
    await render(<OfflineSync />);
    appStateHandler?.("background");
    expect(mockSession.foreground).not.toHaveBeenCalled();
    appStateHandler?.("active");
    expect(mockSession.foreground).toHaveBeenCalledTimes(1);
  });

  it("tells the session when the network comes back, not before", async () => {
    mockNetwork = { isConnected: false, type: "NONE" };
    const view = await render(<OfflineSync />);
    expect(mockSession.network).not.toHaveBeenCalled();
    mockNetwork = { isConnected: true, type: "CELLULAR" };
    await view.rerender(<OfflineSync />);
    expect(mockSession.network).toHaveBeenCalledWith(true);
  });

  it("downloads photos on Wi-Fi or Ethernet only, with the app in front", async () => {
    const view = await render(<OfflineSync />);
    await mockDeps?.sync({ userId: USER });
    const canDownload = mockDefaultDeps.mock.calls[0][1];
    const inFront = (state: string) => Object.defineProperty(AppState, "currentState", { value: state, configurable: true });
    inFront("active");
    expect(canDownload()).toBe(true);
    inFront("background");
    expect(canDownload()).toBe(false);
    inFront("active");
    for (const [type, allowed] of [
      ["ETHERNET", true],
      ["CELLULAR", false],
      ["VPN", false],
      ["OTHER", false],
      ["UNKNOWN", false],
      [undefined, false],
    ] as const) {
      mockNetwork = { isConnected: true, type };
      await view.rerender(<OfflineSync />);
      expect(canDownload()).toBe(allowed);
    }
    mockNetwork = { isConnected: false, type: "WIFI" };
    await view.rerender(<OfflineSync />);
    expect(canDownload()).toBe(false);
  });
});
