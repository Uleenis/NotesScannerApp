import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { StyleSheet } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import { strings } from "@/i18n";
import type { Anchor } from "@/search/search";
import { pageService } from "@/pages/service";
import { searchService } from "@/search/service";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { installFakePages, page, TITLE } from "./fake-page-service";
import { phoneLocale } from "./phone-locale";

jest.setTimeout(30_000);

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("@/pages/timing", () => require("./fake-page-service").timing);
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: {
    watch: () => () => undefined,
    ensureSession: jest.fn(),
    syncLanguage: jest.fn(),
  },
}));
jest.mock("@/lib/query-client", () => {
  const actual = jest.requireActual<typeof import("@/lib/query-client")>("@/lib/query-client");
  const { QueryClient } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, createQueryClient: () => new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock("@/notebooks/service", () => ({
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn(), chapters: jest.fn(async () => []) },
}));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(async () => null), latestNotebookId: jest.fn(async () => null), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: {
    list: jest.fn(),
    get: jest.fn(),
    photoUrl: jest.fn(),
    photoPixels: jest.fn(),
    startReading: jest.fn(),
    setPageType: jest.fn(),
    words: jest.fn(async () => ({ words: [], corrections: [], gaps: [] })),
    correct: jest.fn(),
    edit: jest.fn(),
    alerts: jest.fn(async () => []),
    second: jest.fn(async () => null),
  },
}));
jest.mock("@/search/service", () => ({ searchService: { search: jest.fn(), anchor: jest.fn() } }));

const fr = strings.fr;
const en = strings.en;

const PHOTO = { width: 1000, height: 2000 };
const WORD: Anchor = { kind: "word", box: [100, 400, 300, 500] };

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: false });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  installFakeNotebooks([histoire]);
  installFakePages([page()]);
  jest.mocked(searchService.anchor).mockReset().mockResolvedValue(WORD);
  jest.mocked(pageService.photoPixels).mockReset().mockResolvedValue(PHOTO);
});

async function openPage(url: string) {
  const app = renderRouter("./src/app", { initialUrl: url });
  await app;
  return { getPathname: () => app.getPathname() };
}

async function showPhoto(loaded: { width: number; height: number } = PHOTO) {
  const image = await screen.findByTestId("found-photo-image");
  await fireEvent(image, "load", { nativeEvent: { source: loaded } });
  await fireEvent(screen.getByTestId("found-photo"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 300 } } });
}

describe("a page opened from a search result", () => {
  test("shows the photo with the box of the word found, then the text", async () => {
    await openPage("/page/page-1?found=7");
    await showPhoto();

    const frame = await screen.findByLabelText(fr.search.frameLabel);
    const style = StyleSheet.flatten(frame.props.style);
    expect(style).toMatchObject({ left: "10%", top: "20%", width: "20%", height: "5%" });
    expect(searchService.anchor).toHaveBeenCalledWith("page-1", 7);
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  test("places the box from the size written in the photo, not the smaller size Android loads [2]", async () => {
    await openPage("/page/page-1?found=7");
    await showPhoto({ width: 500, height: 1000 });

    const style = StyleSheet.flatten((await screen.findByLabelText(fr.search.frameLabel)).props.style);
    expect(style).toMatchObject({ left: "10%", top: "20%", width: "20%", height: "5%" });
    expect(pageService.photoPixels).toHaveBeenCalled();
  });

  test("opens on the text alone when the size of the photo cannot be read [2]", async () => {
    jest.mocked(pageService.photoPixels).mockResolvedValue(null);
    await openPage("/page/page-1?found=7");

    await waitFor(() => expect(pageService.photoPixels).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("found-photo-image")).toBeNull());
    expect(screen.queryByTestId("found-photo")).toBeNull();
    expect(screen.queryByLabelText(fr.search.frameLabel)).toBeNull();
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  test("frames a line when the position only has the box of its line", async () => {
    jest.mocked(searchService.anchor).mockResolvedValue({ kind: "line", box: [0, 400, 1000, 500] });
    await openPage("/page/page-1?found=7");
    await showPhoto();

    const style = StyleSheet.flatten((await screen.findByLabelText(fr.search.frameLabel)).props.style);
    expect(style).toMatchObject({ left: "0%", width: "100%" });
  });

  test("opens on the text alone when the position has no box", async () => {
    jest.mocked(searchService.anchor).mockResolvedValue(null);
    await openPage("/page/page-1?found=7");

    expect(await screen.findByText(TITLE)).toBeTruthy();
    await waitFor(() => expect(searchService.anchor).toHaveBeenCalled());
    expect(screen.queryByTestId("found-photo")).toBeNull();
  });

  test("opens on the text alone when the box does not lie on the photo shown", async () => {
    jest.mocked(searchService.anchor).mockResolvedValue({ kind: "word", box: [900, 400, 1300, 500] });
    await openPage("/page/page-1?found=7");

    await waitFor(() => expect(pageService.photoPixels).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("found-photo-image")).toBeNull());
    expect(screen.queryByTestId("found-photo")).toBeNull();
    expect(screen.queryByLabelText(fr.search.frameLabel)).toBeNull();
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  test("opens on the text alone when the box cannot be loaded", async () => {
    jest.mocked(searchService.anchor).mockRejectedValue(new Error("offline"));
    await openPage("/page/page-1?found=7");

    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.queryByTestId("found-photo")).toBeNull();
  });

  test.each(["", "x", "-1", "1.5", "7 ", "99999999999", "0x10"])("ignores a position written %j", async (found) => {
    await openPage(`/page/page-1?found=${encodeURIComponent(found)}`);

    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(searchService.anchor).not.toHaveBeenCalled();
    expect(screen.queryByTestId("found-photo")).toBeNull();
  });

  test("a page opened the usual way has no box", async () => {
    await openPage("/page/page-1");

    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(searchService.anchor).not.toHaveBeenCalled();
    expect(screen.queryByTestId("found-photo")).toBeNull();
  });

  test("a page of math has no positions to frame", async () => {
    installFakePages([page({ pageType: "math", text: "$x$" })]);
    await openPage("/page/page-1?found=7");

    expect(await screen.findByLabelText(fr.document.mathPage)).toBeTruthy();
    expect(searchService.anchor).not.toHaveBeenCalled();
  });

  test("a tap on the photo opens the photo with the same box", async () => {
    const app = await openPage("/page/page-1?found=7");
    await showPhoto();
    await screen.findByLabelText(fr.search.frameLabel);

    await fireEvent.press(screen.getByTestId("found-photo"));

    await waitFor(() => expect(app.getPathname()).toBe("/page/page-1/photo"));
    await fireEvent(await screen.findByTestId("zoomable-photo"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 300 } } });
    await fireEvent(await screen.findByLabelText(fr.photo.label), "load", { nativeEvent: { source: { width: 500, height: 1000 } } });
    const style = StyleSheet.flatten((await screen.findByLabelText(fr.search.frameLabel)).props.style);
    expect(style).toMatchObject({ left: "10%", top: "20%", width: "20%", height: "5%" });
  });

  test("the photo sheet opened the usual way has no box", async () => {
    await openPage("/page/page-1/photo");
    await fireEvent(await screen.findByTestId("zoomable-photo"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 300 } } });
    await fireEvent(await screen.findByLabelText(fr.photo.label), "load", { nativeEvent: { source: PHOTO } });

    expect(screen.queryByLabelText(fr.search.frameLabel)).toBeNull();
    expect(searchService.anchor).not.toHaveBeenCalled();
  });

  test("names the box in English", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openPage("/page/page-1?found=7");
    await showPhoto();

    expect(await screen.findByLabelText(en.search.frameLabel)).toBeTruthy();
    await act(async () => undefined);
  });
});
