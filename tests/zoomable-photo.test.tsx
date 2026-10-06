import { fireEvent, render, screen } from "@testing-library/react-native";

import { displayedSize, maxScaleFor, ZoomablePhoto } from "@/components/reading/zoomable-photo";

type Tree = { type: string; props: Record<string, unknown>; children: Tree[] | null };

function findScrollArea(node: Tree | Tree[] | null): Tree | null {
  if (node === null) {
    return null;
  }
  if (Array.isArray(node)) {
    return node.map(findScrollArea).find((found) => found !== null) ?? null;
  }
  return node.type === "RCTScrollView" ? node : findScrollArea(node.children);
}

describe("displayedSize", () => {
  test("fits a portrait photo in a wide box by its height", () => {
    expect(displayedSize({ width: 3000, height: 4000 }, { width: 400, height: 300 })).toEqual({ width: 225, height: 300 });
  });

  test("fits a landscape photo in a narrow box by its width", () => {
    expect(displayedSize({ width: 4000, height: 3000 }, { width: 400, height: 600 })).toEqual({ width: 400, height: 300 });
  });

  test("gives the box when the photo or the box is not measured yet", () => {
    expect(displayedSize({ width: 0, height: 0 }, { width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
    expect(displayedSize({ width: 3000, height: 4000 }, { width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
  });
});

describe("maxScaleFor", () => {
  test("lets the photo be seen at its own resolution: one pixel of the photo for one pixel of the screen", () => {
    expect(maxScaleFor({ width: 4000, height: 3000 }, { width: 400, height: 300 }, 4)).toBeCloseTo(2.5);
    expect(maxScaleFor({ width: 4000, height: 3000 }, { width: 400, height: 300 }, 2)).toBeCloseTo(5);
  });

  test("always allows at least a zoom of 2, even for a small photo", () => {
    expect(maxScaleFor({ width: 800, height: 600 }, { width: 400, height: 300 }, 3)).toBe(2);
  });

  test("never allows more than a zoom of 8", () => {
    expect(maxScaleFor({ width: 12000, height: 9000 }, { width: 400, height: 300 }, 1)).toBe(8);
  });

  test("allows a zoom of 2 while the photo or the box is not measured", () => {
    expect(maxScaleFor({ width: 0, height: 0 }, { width: 400, height: 300 }, 3)).toBe(2);
    expect(maxScaleFor({ width: 4000, height: 3000 }, { width: 0, height: 0 }, 3)).toBe(2);
  });
});

describe("ZoomablePhoto", () => {
  test("shows the photo it is given, uncropped, with its label", async () => {
    await render(<ZoomablePhoto uri="https://photos.test/p.jpg" label="La page telle qu'elle a été prise" />);

    const image = screen.getByLabelText("La page telle qu'elle a été prise");
    expect(image.props.source).toEqual({ uri: "https://photos.test/p.jpg" });
    expect(image.props.resizeMode).toBe("contain");
  });

  test("sits in a nested scrolling area that never scrolls, so that the sheet of Android leaves its touches to the gestures", async () => {
    await render(<ZoomablePhoto uri="https://photos.test/p.jpg" label="Photo" />);

    const area = findScrollArea(screen.toJSON() as Tree | Tree[] | null);
    expect(area?.props.scrollEnabled).toBe(false);
    expect(area?.props.nestedScrollEnabled).toBe(true);
    expect(JSON.stringify(area?.children)).toContain("Photo");
  });

  test("takes the size of its box and of the photo without error", async () => {
    await render(<ZoomablePhoto uri="https://photos.test/p.jpg" label="Photo" />);

    await fireEvent(screen.getByTestId("zoomable-photo"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 300 } } });
    await fireEvent(screen.getByLabelText("Photo"), "load", { nativeEvent: { source: { width: 3000, height: 4000 } } });

    expect(screen.getByLabelText("Photo")).toBeTruthy();
  });
});
