import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ActionSheetIOS, BackHandler, Platform, StyleSheet } from "react-native";

import { SafeAreaProvider } from "react-native-safe-area-context";

import { ActionSheetHost } from "@/components/action-sheet-host";
import { closeMenu, showMenu } from "@/lib/action-menu";
import { colors } from "@/theme";

let ios: jest.SpyInstance;
type BackHandlerFn = Parameters<typeof BackHandler.addEventListener>[1];

let backHandlers: BackHandlerFn[];

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

async function renderHost() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ActionSheetHost />
    </SafeAreaProvider>,
  );
}

function colorOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).color;
}

function useAndroid() {
  jest.replaceProperty(Platform, "OS", "android");
}

beforeEach(() => {
  ios = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => undefined);
  backHandlers = [];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((_, handler) => {
    backHandlers.push(handler);
    return {
      remove: () => {
        backHandlers = backHandlers.filter((candidate) => candidate !== handler);
      },
    };
  });
});

afterEach(async () => {
  await act(async () => closeMenu());
  jest.restoreAllMocks();
});

async function open(onFirst = jest.fn(), onDelete = jest.fn()) {
  await renderHost();
  await act(async () =>
    showMenu(
      [
        { label: "Rename", onPress: onFirst },
        { label: "Delete", destructive: true, onPress: onDelete },
      ],
      "Cancel",
    ),
  );
  return { onFirst, onDelete };
}

describe.each(["android", "ios"] as const)("showMenu on %s", (os) => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", os);
  });

  test("never calls ActionSheetIOS", async () => {
    await open();
    expect(ios).not.toHaveBeenCalled();
  });

  test("shows its options in order, then Cancel", async () => {
    await open();
    const labels = screen.getAllByRole("button").map((button) => button.props.accessibilityLabel);
    expect(labels).toEqual(["Rename", "Delete", "Cancel"]);
  });

  test("shows nothing before a menu is asked for", async () => {
    await renderHost();
    expect(screen.queryByText("Cancel")).toBeNull();
  });

  test("calls the option that is touched, once, and closes", async () => {
    const { onFirst, onDelete } = await open();
    await fireEvent.press(screen.getByLabelText("Delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onFirst).not.toHaveBeenCalled();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  test("calls nothing on Cancel", async () => {
    const { onFirst, onDelete } = await open();
    await fireEvent.press(screen.getByLabelText("Cancel"));
    expect(onFirst).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("Rename")).toBeNull();
  });

  test("calls nothing on a touch outside the sheet", async () => {
    const { onFirst, onDelete } = await open();
    await fireEvent.press(screen.getByTestId("action-sheet-backdrop"));
    expect(onFirst).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("Rename")).toBeNull();
  });

  test("marks the destructive option and no other", async () => {
    await open();
    expect(colorOf("action-sheet-label-1")).toBe(colors.danger);
    expect(colorOf("action-sheet-label-0")).not.toBe(colors.danger);
  });
});

describe("the back button of Android", () => {
  test("closes the sheet and calls nothing", async () => {
    useAndroid();
    const { onFirst, onDelete } = await open();
    expect(backHandlers).toHaveLength(1);
    let consumed = false;
    await act(async () => {
      consumed = backHandlers[0]({} as never) === true;
    });
    expect(consumed).toBe(true);
    expect(onFirst).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("Rename")).toBeNull();
  });

  test("is left alone once the sheet is closed", async () => {
    useAndroid();
    await open();
    await act(async () => closeMenu());
    expect(backHandlers).toHaveLength(0);
  });
});

describe("a second menu", () => {
  test("replaces the first and calls only its own options", async () => {
    await renderHost();
    const first = jest.fn();
    const second = jest.fn();
    await act(async () => showMenu([{ label: "One", onPress: first }], "Cancel"));
    await act(async () => showMenu([{ label: "Two", onPress: second }], "Close"));
    expect(screen.queryByText("One")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Two"));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
