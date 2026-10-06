import { render, screen } from "@testing-library/react-native";

import { InkStroke } from "@/components/reading/ink-stroke";

type Tree = { type: string; props: Record<string, unknown>; children: Tree[] | null };

function findPath(node: Tree | Tree[] | null): Tree | null {
  if (node === null) {
    return null;
  }
  if (Array.isArray(node)) {
    return node.map(findPath).find((found) => found !== null) ?? null;
  }
  return node.type === "RNSVGPath" ? node : findPath(node.children);
}

function drawn(): { color: number; dashes: unknown } {
  const path = findPath(screen.toJSON() as Tree | Tree[] | null);
  const stroke = path?.props.stroke as { payload: number };
  return { color: stroke.payload, dashes: path?.props.strokeDasharray };
}

const BLUE = 0xff24358f;
const RULE = 0xffddd6c9;
const INK = 0xff1f1d1a;

describe("InkStroke", () => {
  test("draws the animated stroke in blue, with a dash as long as the path to write and erase it", async () => {
    await render(<InkStroke tone="blue" animated />);
    expect(drawn()).toEqual({ color: BLUE, dashes: [144, 144] });
  });

  test("draws a still stroke in the color of the rules, whole", async () => {
    await render(<InkStroke tone="rule" animated={false} />);
    expect(drawn()).toEqual({ color: RULE, dashes: undefined });
  });

  test("draws a still stroke in ink", async () => {
    await render(<InkStroke tone="ink" animated={false} />);
    expect(drawn().color).toBe(INK);
  });

  test("follows the width it is given, keeping its proportions", async () => {
    await render(<InkStroke tone="blue" animated={false} width={74} />);
    const svg = screen.toJSON() as Tree;
    expect(svg.props.width).toBe(74);
    expect(svg.props.height).toBe(8);
  });

  test("goes away without leaving an error", async () => {
    const view = await render(<InkStroke tone="blue" animated />);
    await expect(view.unmount()).resolves.toBeUndefined();
  });
});
