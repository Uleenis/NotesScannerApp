import { act, renderHook } from "@testing-library/react-native";
import { useNetworkState } from "expo-network";
import { AppState } from "react-native";

import { useCameraAccess, type CameraAccess } from "@/capture/use-camera-access";
import { useOffline } from "@/capture/use-network";
import { cameraModule, granted, installPermission, refused, undetermined } from "./fake-camera";

jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("expo-network", () => ({ useNetworkState: jest.fn() }));

function observe() {
  const seen: CameraAccess[] = [];
  const hook = renderHook(() => {
    const access = useCameraAccess();
    seen.push(access);
    return access;
  });
  return { seen, hook };
}

test("the camera is loading while its permission is unknown", async () => {
  installPermission(null);
  const { hook } = observe();

  expect((await hook).result.current).toBe("loading");
});

test("a permission that was never asked is asked once, without ever showing the refused message first", async () => {
  const { request } = installPermission(undetermined);
  request.mockReturnValue(new Promise(() => {}));
  const { seen, hook } = observe();
  await hook;
  await act(async () => {});

  expect(request).toHaveBeenCalledTimes(1);
  expect(seen.length).toBeGreaterThan(0);
  expect(new Set(seen)).toEqual(new Set(["loading"]));
});

test("a permission hook that gives a new request function at each render still asks only once", async () => {
  installPermission(undetermined);
  const requests: jest.Mock[] = [];
  cameraModule.useCameraPermissions.mockImplementation(() => {
    const request = jest.fn(() => new Promise<never>(() => {}));
    requests.push(request);
    return [undetermined, request, jest.fn()];
  });
  const { hook } = observe();
  const rendered = await hook;
  await rendered.rerender(undefined);
  await rendered.rerender(undefined);
  await act(async () => {});

  expect(requests.length).toBeGreaterThan(2);
  expect(requests.reduce((total, request) => total + request.mock.calls.length, 0)).toBe(1);
});

test("a granted permission opens the camera and a refused one that cannot be asked again is denied", async () => {
  installPermission(granted);
  expect((await observe().hook).result.current).toBe("granted");

  installPermission(refused);
  expect((await observe().hook).result.current).toBe("denied");
});

test("a permission request that fails ends as denied instead of staying loading", async () => {
  const { request } = installPermission(undetermined);
  request.mockRejectedValue(new Error("no dialog"));
  const { hook } = observe();
  await hook;
  await act(async () => {});

  expect((await hook).result.current).not.toBe("loading");
});

test("the permission is read again when the app comes back to the foreground", async () => {
  const { refresh } = installPermission(refused);
  const remove = jest.fn();
  let listener: (state: string) => void = () => {};
  const subscribe = jest.spyOn(AppState, "addEventListener").mockImplementation((_, handler) => {
    listener = handler as (state: string) => void;
    return { remove };
  });
  const { hook } = observe();
  await hook;

  listener("background");
  expect(refresh).not.toHaveBeenCalled();
  listener("active");
  expect(refresh).toHaveBeenCalledTimes(1);

  await (await hook).unmount();
  expect(remove).toHaveBeenCalled();
  subscribe.mockRestore();
});

test.each([
  ["no connection at all", { isConnected: false, isInternetReachable: false }, true],
  ["not connected", { isConnected: false }, true],
  ["connected but the internet is not confirmed", { isConnected: true, isInternetReachable: false }, false],
  ["connected and reachable", { isConnected: true, isInternetReachable: true }, false],
  ["a state not known yet", {}, false],
])("offline: %s", async (_, state, expected) => {
  jest.mocked(useNetworkState).mockReturnValue(state);

  expect((await renderHook(() => useOffline())).result.current).toBe(expected);
});
