import { fireEvent, render, screen } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import { StyleSheet } from "react-native";

import { PhotoReview } from "@/components/capture/photo-review";
import { Viewfinder } from "@/components/capture/viewfinder";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
});

function size(testID: string): { width?: unknown; height?: unknown } {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

async function layout(testID: string, width: number, height: number): Promise<void> {
  await fireEvent(screen.getByTestId(testID), "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
}

describe("the viewfinder", () => {
  test("has the shape of the photo, three wide for four high, so it shows exactly what will be taken", async () => {
    await render(<Viewfinder flash={false} onReady={() => undefined} />);
    await layout("viewfinder-area", 360, 600);

    expect(size("viewfinder")).toMatchObject({ width: 360, height: 480 });
  });

  test("keeps that shape when the screen leaves less height than width allows", async () => {
    await render(<Viewfinder flash={false} onReady={() => undefined} />);
    await layout("viewfinder-area", 360, 400);

    expect(size("viewfinder")).toMatchObject({ width: 300, height: 400 });
  });
});

describe("the check of the photo", () => {
  async function review(photo: { width: number; height: number }) {
    await render(
      <PhotoReview
        message={null}
        onRead={() => undefined}
        onRetake={() => undefined}
        onRotate={() => undefined}
        photoUri="file:///cache/prepared.jpg"
        sending={false}
        title="Page 1 · Essai"
        turning={false}
      />,
    );
    await layout("photo-review-area", 360, 600);
    await fireEvent(screen.getByTestId("photo-review"), "load", { nativeEvent: { source: photo } });
  }

  test("frames a photo in its own shape, with no band above or below", async () => {
    await review({ width: 3000, height: 4000 });

    expect(size("photo-review-frame")).toMatchObject({ width: 360, height: 480 });
  });

  test("frames a photo turned on its side in its own shape too", async () => {
    await review({ width: 4000, height: 3000 });

    expect(size("photo-review-frame")).toMatchObject({ width: 360, height: 270 });
  });

  test("uses the shape of the camera until the photo is loaded", async () => {
    await render(
      <PhotoReview
        message={null}
        onRead={() => undefined}
        onRetake={() => undefined}
        onRotate={() => undefined}
        photoUri="file:///cache/prepared.jpg"
        sending={false}
        title="Page 1 · Essai"
        turning={false}
      />,
    );
    await layout("photo-review-area", 360, 600);

    expect(size("photo-review-frame")).toMatchObject({ width: 360, height: 480 });
  });
});
