import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Text } from "react-native";

import { measureDeps, shareMeasure } from "@/capture/measure";
import { scanForMeasure } from "@/capture/scanner";
import { strings } from "@/i18n";
import MeasureScreen from "../src/app/measure";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("@/capture/scanner", () => ({ scanForMeasure: jest.fn() }));
jest.mock("@/capture/measure", () => ({ shareMeasure: jest.fn(), measureDeps: { discard: jest.fn() } }));

const t = strings.en;
const devFlag = globalThis as unknown as { __DEV__: boolean };

function Home() {
  return <Text>home</Text>;
}

beforeEach(() => {
  devFlag.__DEV__ = true;
  jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  jest.mocked(scanForMeasure).mockReset();
  jest.mocked(shareMeasure).mockReset();
});

afterAll(() => {
  devFlag.__DEV__ = true;
});

async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

it("scans with the measure scanner and shares the pages", async () => {
  jest.mocked(scanForMeasure).mockResolvedValue({ status: "scanned", uris: ["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg"] });
  jest.mocked(shareMeasure).mockResolvedValue(true);
  await renderRouter({ index: Home, measure: MeasureScreen }, { initialUrl: "/measure" });

  await fireEvent.press(await screen.findByText(t.measure.scan));
  await settle();
  expect(screen.getByText(t.measure.scanned(2))).toBeTruthy();

  await fireEvent.press(await screen.findByText(t.measure.share));
  await settle();
  expect(jest.mocked(shareMeasure).mock.calls[0][0]).toEqual(["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg"]);
  expect(screen.queryByText(t.measure.share)).toBeNull();
});

it("says when the scanner is not available", async () => {
  jest.mocked(scanForMeasure).mockResolvedValue({ status: "unavailable" });
  await renderRouter({ index: Home, measure: MeasureScreen }, { initialUrl: "/measure" });

  await fireEvent.press(await screen.findByText(t.measure.scan));
  await settle();

  expect(screen.getByText(t.measure.unavailable)).toBeTruthy();
});

it("is not reachable outside a development build", async () => {
  devFlag.__DEV__ = false;
  await renderRouter({ index: Home, measure: MeasureScreen }, { initialUrl: "/measure" });
  await settle();

  expect(screen.getByText("home")).toBeTruthy();
  expect(screen.queryByText(t.measure.scan)).toBeNull();
  expect(scanForMeasure).not.toHaveBeenCalled();
});

it("erases the pages of a scan that ends after the screen is gone", async () => {
  let finish: (value: { status: "scanned"; uris: string[] }) => void = () => undefined;
  jest.mocked(scanForMeasure).mockReturnValue(new Promise((resolve) => (finish = resolve)));
  jest.mocked(measureDeps.discard).mockClear();
  await renderRouter({ index: Home, measure: MeasureScreen }, { initialUrl: "/measure" });

  await fireEvent.press(await screen.findByText(t.measure.scan));
  screen.unmount();
  await act(async () => {
    finish({ status: "scanned", uris: ["file:///cache/scans/a.jpg"] });
    await jest.advanceTimersByTimeAsync(0);
  });

  expect(jest.mocked(measureDeps.discard).mock.calls.map((call) => call[0])).toEqual(["file:///cache/scans/a.jpg"]);
});
