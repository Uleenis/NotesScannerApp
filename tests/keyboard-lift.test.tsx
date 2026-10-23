import { act, render, screen } from "@testing-library/react-native";
import { Keyboard, Platform, StyleSheet, Text, View, type KeyboardEvent } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { KeyboardLift } from "@/components/keyboard-lift";

type Measure = (callback: (x: number, y: number, width: number, height: number) => void) => void;

function place(top: number, height: number) {
  const measure: Measure = (callback) => callback(0, top, 360, height);
  (View.prototype as unknown as { measureInWindow: Measure }).measureInWindow = measure;
}

function paddingBottom(): number {
  const style = StyleSheet.flatten(screen.getByTestId("lift").props.style) as { paddingBottom?: number };
  return style.paddingBottom ?? 0;
}

async function renderLift(bottomInset?: number) {
  const lift = (
    <KeyboardLift testID="lift">
      <Text>content</Text>
    </KeyboardLift>
  );
  await render(
    bottomInset === undefined ? (
      lift
    ) : (
      <SafeAreaInsetsContext.Provider value={{ top: 24, left: 0, right: 0, bottom: bottomInset }}>{lift}</SafeAreaInsetsContext.Provider>
    ),
  );
}

type Listener = (event: KeyboardEvent) => void;

let listeners: Map<string, Listener[]>;

function emit(name: string, event: KeyboardEvent) {
  return act(async () => {
    (listeners.get(name) ?? []).forEach((listener) => listener(event));
  });
}

async function showKeyboard(screenY: number, height: number) {
  await emit(Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow", {
    endCoordinates: { screenY, height, width: 360, screenX: 0 },
  } as KeyboardEvent);
}

async function hideKeyboard() {
  await emit(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", {
    endCoordinates: { screenY: 800, height: 0, width: 360, screenX: 0 },
  } as KeyboardEvent);
}

beforeEach(() => {
  listeners = new Map();
  jest.spyOn(Keyboard, "addListener").mockImplementation(((name: string, listener: Listener) => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    return {
      remove: () => {
        listeners.set(name, (listeners.get(name) ?? []).filter((candidate) => candidate !== listener));
      },
    };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(["android", "ios"] as const)("the lift on %s", (os) => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", os);
  });

  test("lifts its content by the part of the keyboard that covers it, wherever it starts [9]", async () => {
    place(100, 700);
    await renderLift();
    expect(paddingBottom()).toBe(0);
    await showKeyboard(500, 300);
    expect(paddingBottom()).toBe(300);
  });

  test("does not depend on a header above it [9]", async () => {
    place(0, 800);
    await renderLift();
    await showKeyboard(500, 300);
    expect(paddingBottom()).toBe(300);
  });

  test("lifts by the covered part only when the keyboard stops short of the bottom [9]", async () => {
    place(100, 600);
    await renderLift();
    await showKeyboard(500, 300);
    expect(paddingBottom()).toBe(200);
  });

  test("does not lift for a keyboard below it", async () => {
    place(100, 300);
    await renderLift();
    await showKeyboard(500, 300);
    expect(paddingBottom()).toBe(0);
  });

  test("follows a keyboard that changes height, then goes back when it closes [9]", async () => {
    place(0, 800);
    await renderLift();
    await showKeyboard(500, 300);
    await showKeyboard(450, 350);
    expect(paddingBottom()).toBe(350);
    await hideKeyboard();
    expect(paddingBottom()).toBe(0);
  });

  test("keeps clear of the system bar while the keyboard is closed, and takes the keyboard's place when it opens [9]", async () => {
    place(0, 800);
    await renderLift(24);
    expect(paddingBottom()).toBe(24);
    await showKeyboard(500, 300);
    expect(paddingBottom()).toBe(300);
    await hideKeyboard();
    expect(paddingBottom()).toBe(24);
  });

  test("shows its children", async () => {
    place(0, 800);
    await renderLift();
    expect(screen.getByText("content")).toBeTruthy();
  });
});
