import { useLocales } from "expo-localization";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import type { TrainingState } from "@/training/api";
import { trainingService } from "@/training/service";
import type { RunDeps } from "@/training/run-writing-test";
import texts from "@/training/writing-test-texts.json";
import type { Upload } from "@/training/writing-api";
import { writingService } from "@/training/writing-service";
import { installFakeAccount } from "./fake-account-service";
import { granted, installPermission, refused, takePictureAsync } from "./fake-camera";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: { watch: () => () => undefined, ensureSession: jest.fn(), syncLanguage: jest.fn() },
}));
jest.mock("@/auth/account-service", () => require("./account-service-module").accountServiceModule);
jest.mock("@/lib/query-client", () => {
  const actual = jest.requireActual<typeof import("@/lib/query-client")>("@/lib/query-client");
  const { QueryClient } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, createQueryClient: () => new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock("@/notebooks/service", () => ({ notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn(), chapters: jest.fn(async () => []) } }));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn(), preparePhoto: jest.fn(), discardPhoto: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(async () => []), count: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn(), words: jest.fn(), correct: jest.fn(), edit: jest.fn(), alerts: jest.fn(async () => []), second: jest.fn(async () => null) },
}));
jest.mock("@/training/service", () => ({
  trainingService: { state: jest.fn(), saveAge: jest.fn(), grantConsent: jest.fn(), requestParent: jest.fn(), confirmParent: jest.fn(), revoke: jest.fn() },
}));
jest.mock("@/training/writing-service", () => ({ writingService: { deps: jest.fn() } }));

jest.setTimeout(30_000);

const fr = strings.fr;
const en = strings.en;

const TEST_ID = "5e5e5e5e-0000-4000-8000-000000000001";
const UPLOADS: [Upload, Upload] = [
  { path: `u/writing-tests/${TEST_ID}/1.jpg`, token: "token-1" },
  { path: `u/writing-tests/${TEST_ID}/2.jpg`, token: "token-2" },
];

const registeredAllowance: Allowance = { isAnonymous: false, used: 9, max: 15, remaining: 6, resetsAt: null, blockedReason: null };

let state: TrainingState;
let deps: { [K in keyof RunDeps]: jest.Mock };
let prepared = 0;

function fakeDeps(): typeof deps {
  return {
    start: jest.fn(async () => ({ status: "ready", testId: TEST_ID, uploads: UPLOADS })),
    upload: jest.fn(async () => "uploaded"),
    check: jest.fn(async () => "started"),
    read: jest.fn(async () => ({ status: "accepted", training: 30, validation: 10, redo: [] })),
    wait: jest.fn(async () => undefined),
    now: jest.fn(() => 0),
  };
}

beforeEach(() => {
  state = { birthYear: 1990, consent: "user" };
  prepared = 0;
  jest.mocked(useLocales).mockReturnValue([{ ...phoneLocale("fr"), regionCode: "FR" }]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: "reader@example.test", isAnonymous: false });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(registeredAllowance);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(null);
  jest.mocked(captureService.preparePhoto).mockReset().mockImplementation(async () => `file:///cache/sheet-${++prepared}.jpg`);
  jest.mocked(captureService.discardPhoto).mockReset();
  installFakeNotebooks([histoire]);
  installFakeAccount();
  installPermission(granted);
  jest.mocked(trainingService.state).mockReset().mockImplementation(async () => ({ ...state }));
  deps = fakeDeps();
  jest.mocked(writingService.deps).mockReset().mockReturnValue(deps);
});

async function open(url = "/training/writing-test"): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl: url });
  await app;
  return () => app.getPathname();
}

async function photograph(sheet: number, again = false): Promise<void> {
  const label = again ? fr.training.writing.photographAgain(sheet) : fr.training.writing.photograph(sheet);
  await fireEvent.press(await screen.findByText(label));
  await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));
  await fireEvent.press(await screen.findByText(fr.training.writing.useThis));
}

async function photographBoth(): Promise<void> {
  await photograph(1);
  await photograph(2);
}

async function send(): Promise<void> {
  await fireEvent.press(await screen.findByText(fr.training.writing.send));
}

describe("the entry", () => {
  test("a user who agreed opens the writing test from the state of the training", async () => {
    const pathname = await open("/training");

    await fireEvent.press(await screen.findByText(fr.training.writing.row));

    await waitFor(() => expect(pathname()).toBe("/training/writing-test"));
  });

  test("nobody is offered the test before agreeing", async () => {
    state = { birthYear: 1990, consent: "none" };
    await open("/training");
    await screen.findByText(fr.training.intro);

    expect(screen.queryByText(fr.training.writing.row)).toBeNull();
  });

  test("the test itself asks for the consent first and offers no photo without it", async () => {
    state = { birthYear: 1990, consent: "none" };
    await open();

    expect(await screen.findByText(fr.training.writing.errors.consent)).toBeTruthy();
    expect(screen.queryByText(fr.training.writing.photograph(1))).toBeNull();
  });
});

describe("the text to copy", () => {
  test("shows the two sheets with their numbered lines, in the language of the phone", async () => {
    await open();

    expect(await screen.findByText(fr.training.writing.intro)).toBeTruthy();
    expect(screen.getByText(fr.training.writing.copyRule)).toBeTruthy();
    expect(screen.getByText(fr.training.writing.sheetTitle(1))).toBeTruthy();
    expect(screen.getByText(fr.training.writing.sheetTitle(2))).toBeTruthy();
    expect(screen.getByText(texts.fr.lines[0])).toBeTruthy();
    expect(screen.getByText(texts.fr.lines[19])).toBeTruthy();
    expect(screen.getByText(texts.fr.lines[20])).toBeTruthy();
    expect(screen.getByText(texts.fr.lines[39])).toBeTruthy();
    expect(screen.getAllByText("20")).toHaveLength(2);
  });

  test("shows the English text to a phone in English", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await open();

    expect(await screen.findByText(en.training.writing.intro)).toBeTruthy();
    expect(screen.getByText(texts.en.lines[0])).toBeTruthy();
    expect(screen.queryByText(texts.fr.lines[0])).toBeNull();
  });

  test("says which lines of the second sheet carry a mistake on purpose, and none on the first", async () => {
    await open();

    const lines = texts.fr.faults.map((fault) => fault.line - 20);
    expect(await screen.findByText(fr.training.writing.faultsNote(lines.join(", ")))).toBeTruthy();
    expect(screen.getAllByText(/contiennent une faute voulue/)).toHaveLength(1);
  });
});

describe("the photos", () => {
  test("the test cannot be sent before both sheets are photographed", async () => {
    await open();

    await photograph(1);
    expect(await screen.findByText(fr.training.writing.photographed)).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.training.writing.send));

    expect(deps.start).not.toHaveBeenCalled();
    expect(captureService.preparePhoto).toHaveBeenCalledTimes(1);
  });

  test("a photo can be retaken before it is used, and the first one is discarded", async () => {
    await open();
    await fireEvent.press(await screen.findByText(fr.training.writing.photograph(1)));
    await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));
    await fireEvent.press(await screen.findByText(fr.capture.retake));

    await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));
    await fireEvent.press(await screen.findByText(fr.training.writing.useThis));

    expect(captureService.discardPhoto).toHaveBeenCalledWith("file:///cache/sheet-1.jpg");
    expect(await screen.findByText(fr.training.writing.photographAgain(1))).toBeTruthy();
  });

  test("a failed shot says so and keeps the camera", async () => {
    takePictureAsync.mockRejectedValueOnce(new Error("no"));
    await open();
    await fireEvent.press(await screen.findByText(fr.training.writing.photograph(1)));
    await fireEvent.press(await screen.findByLabelText(fr.capture.shutterLabel));

    expect(await screen.findByText(fr.training.writing.errors.shot)).toBeTruthy();
    expect(screen.getByLabelText(fr.capture.shutterLabel)).toBeTruthy();
  });

  test("asks to open the settings when the camera is refused", async () => {
    installPermission(refused);
    await open();
    await fireEvent.press(await screen.findByText(fr.training.writing.photograph(1)));

    expect(await screen.findByText(fr.capture.cameraNeeded)).toBeTruthy();
    expect(screen.queryByLabelText(fr.capture.shutterLabel)).toBeNull();
  });
});

describe("the check", () => {
  test("sends both photos in order and says the test is accepted", async () => {
    await open();
    await photographBoth();
    await send();

    expect(await screen.findByText(fr.training.writing.acceptedTitle)).toBeTruthy();
    expect(screen.getByText(fr.training.writing.acceptedBody)).toBeTruthy();
    expect(deps.start).toHaveBeenCalledWith("fr");
    expect(deps.upload).toHaveBeenNthCalledWith(1, UPLOADS[0], "file:///cache/sheet-1.jpg");
    expect(deps.upload).toHaveBeenNthCalledWith(2, UPLOADS[1], "file:///cache/sheet-2.jpg");
    expect(deps.check).toHaveBeenCalledWith(TEST_ID);
  });

  test("shows that it is checking while it waits", async () => {
    let release: (value: unknown) => void = () => undefined;
    deps.read.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await open();
    await photographBoth();
    await send();

    expect(await screen.findByText(fr.training.writing.checkingTitle)).toBeTruthy();
    expect(screen.getByText(fr.training.writing.checkingBody)).toBeTruthy();
    release({ status: "accepted", training: 30, validation: 10, redo: [] });
    await screen.findByText(fr.training.writing.acceptedTitle);
  });

  test("a test that is not accepted says which sheet to write again and keeps the other photo", async () => {
    deps.read.mockResolvedValue({ status: "rejected", training: 12, validation: 10, redo: [1] });
    await open();
    await photographBoth();
    await send();

    expect(await screen.findByText(fr.training.writing.rejectedTitle)).toBeTruthy();
    expect(screen.getByText(fr.training.writing.rejectedBody([1]))).toBeTruthy();
    expect(screen.getByText(fr.training.writing.rejectedTip)).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.training.writing.redo));

    expect(await screen.findByText(fr.training.writing.photograph(1))).toBeTruthy();
    expect(screen.getByText(fr.training.writing.photographAgain(2))).toBeTruthy();
    expect(captureService.discardPhoto).toHaveBeenCalledWith("file:///cache/sheet-1.jpg");
    expect(captureService.discardPhoto).not.toHaveBeenCalledWith("file:///cache/sheet-2.jpg");
  });

  test("two sheets to write again are both named", async () => {
    deps.read.mockResolvedValue({ status: "rejected", training: 2, validation: 1, redo: [1, 2] });
    await open();
    await photographBoth();
    await send();

    expect(await screen.findByText(fr.training.writing.rejectedBody([1, 2]))).toBeTruthy();
  });

  test.each([
    ["limit", fr.training.writing.errors.limit],
    ["in_progress", fr.training.writing.errors.inProgress],
    ["consent_required", fr.training.writing.errors.consent],
  ] as const)("says what %s means and sends nothing", async (status, message) => {
    deps.start.mockResolvedValue({ status });
    await open();
    await photographBoth();
    await send();

    expect(await screen.findByText(message)).toBeTruthy();
    expect(deps.upload).not.toHaveBeenCalled();
  });

  test("a connection lost during the sending lets the user try again without starting another test", async () => {
    deps.upload.mockResolvedValueOnce("uploaded").mockResolvedValueOnce("network");
    await open();
    await photographBoth();
    await send();

    expect(await screen.findByText(fr.training.writing.errors.offline)).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.training.writing.tryAgain));

    expect(await screen.findByText(fr.training.writing.acceptedTitle)).toBeTruthy();
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(deps.upload).toHaveBeenCalledTimes(3);
  });

  test("a check that failed on the server says so and lets the user send again", async () => {
    deps.read.mockResolvedValueOnce({ status: "failed", training: null, validation: null, redo: [] });
    await open();
    await photographBoth();
    await send();

    expect(await screen.findByText(fr.training.writing.errors.failed)).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.training.writing.tryAgain));
    await send();

    expect(await screen.findByText(fr.training.writing.acceptedTitle)).toBeTruthy();
    expect(deps.start).toHaveBeenCalledTimes(2);
  });

  test("a photo the server refuses sends the user back to that sheet", async () => {
    deps.upload.mockResolvedValueOnce("uploaded").mockResolvedValueOnce("refused");
    await open();
    await photographBoth();
    await send();

    expect(await screen.findByText(fr.training.writing.errors.photo)).toBeTruthy();
    expect(screen.getByText(fr.training.writing.photograph(2))).toBeTruthy();
    expect(screen.getByText(fr.training.writing.photographAgain(1))).toBeTruthy();
    expect(captureService.discardPhoto).toHaveBeenCalledWith("file:///cache/sheet-2.jpg");
  });

  test("a sheet photographed again after its upload starts a new test, so that the new photo is the one checked", async () => {
    deps.upload.mockResolvedValueOnce("uploaded").mockResolvedValueOnce("refused");
    await open();
    await photographBoth();
    await send();
    await screen.findByText(fr.training.writing.errors.photo);

    await photograph(1, true);
    await photograph(2);
    await send();

    expect(await screen.findByText(fr.training.writing.acceptedTitle)).toBeTruthy();
    expect(deps.start).toHaveBeenCalledTimes(2);
    expect(deps.upload).toHaveBeenLastCalledWith(UPLOADS[1], "file:///cache/sheet-4.jpg");
  });

  test("shows the same sentences in English", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    deps.read.mockResolvedValue({ status: "rejected", training: 12, validation: 10, redo: [2] });
    await open();
    await fireEvent.press(await screen.findByText(en.training.writing.photograph(1)));
    await fireEvent.press(await screen.findByLabelText(en.capture.shutterLabel));
    await fireEvent.press(await screen.findByText(en.training.writing.useThis));
    await fireEvent.press(await screen.findByText(en.training.writing.photograph(2)));
    await fireEvent.press(await screen.findByLabelText(en.capture.shutterLabel));
    await fireEvent.press(await screen.findByText(en.training.writing.useThis));
    await fireEvent.press(await screen.findByText(en.training.writing.send));

    expect(await screen.findByText(en.training.writing.rejectedBody([2]))).toBeTruthy();
    expect(deps.start).toHaveBeenCalledWith("en");
  });
});
