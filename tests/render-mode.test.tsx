import { act, renderHook } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import { loadRenderMode, resetRenderMode, setRenderMode, useRenderMode } from "@/render/mode";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));

const getItem = jest.mocked(SecureStore.getItemAsync);
const setItem = jest.mocked(SecureStore.setItemAsync);

beforeEach(() => {
  resetRenderMode();
  getItem.mockReset().mockResolvedValue(null);
  setItem.mockReset().mockResolvedValue(undefined);
});

describe("render mode", () => {
  it("is faithful until a choice was stored", async () => {
    expect(await loadRenderMode()).toBe("faithful");
    const { result } = await renderHook(() => useRenderMode());
    expect(result.current).toBe("faithful");
  });

  it("restores the enriched choice after a restart", async () => {
    getItem.mockResolvedValue("enriched");
    const { result } = await renderHook(() => useRenderMode());
    await act(async () => {
      await loadRenderMode();
    });
    expect(result.current).toBe("enriched");
    expect(getItem).toHaveBeenCalledWith("render-mode");
  });

  it("reads anything else as faithful", async () => {
    getItem.mockResolvedValue("rich");
    expect(await loadRenderMode()).toBe("faithful");
    resetRenderMode();
    getItem.mockRejectedValue(new Error("locked"));
    expect(await loadRenderMode()).toBe("faithful");
  });

  it("keeps a choice for every screen, and on the phone", async () => {
    const first = await renderHook(() => useRenderMode());
    const second = await renderHook(() => useRenderMode());
    await act(async () => {
      await loadRenderMode();
    });
    await act(async () => setRenderMode("enriched"));
    expect(first.result.current).toBe("enriched");
    expect(second.result.current).toBe("enriched");
    expect(setItem).toHaveBeenCalledWith("render-mode", "enriched");
    await act(async () => setRenderMode("faithful"));
    expect(second.result.current).toBe("faithful");
    expect(setItem).toHaveBeenLastCalledWith("render-mode", "faithful");
  });

  it("keeps the choice when it cannot be written", async () => {
    setItem.mockRejectedValue(new Error("full"));
    const { result } = await renderHook(() => useRenderMode());
    await act(async () => setRenderMode("enriched"));
    expect(result.current).toBe("enriched");
  });

  it("does not let a late read overwrite a choice made meanwhile", async () => {
    let release: (value: string | null) => void = () => undefined;
    getItem.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const pending = loadRenderMode();
    await act(async () => setRenderMode("faithful"));
    await act(async () => setRenderMode("enriched"));
    await act(async () => {
      release("faithful");
      await pending;
    });
    const { result } = await renderHook(() => useRenderMode());
    expect(result.current).toBe("enriched");
  });
});
