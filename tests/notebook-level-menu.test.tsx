import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { ActionSheetIOS, Alert } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import { strings } from "@/i18n";
import { closeMenu } from "@/lib/action-menu";
import { levelService } from "@/notebooks/level-service";
import { trainingService } from "@/training/service";
import { installFakeLibrary } from "./fake-library";
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
jest.mock("@/notebooks/service", () => ({ notebookService: require("./library-mocks").NOTEBOOK_SERVICE_MOCK }));
jest.mock("@/pages/service", () => ({ pageService: require("./library-mocks").PAGE_SERVICE_MOCK }));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(async () => null), latestNotebookId: jest.fn(async () => null), send: jest.fn() },
}));
jest.mock("@/notebooks/level-service", () => ({ levelService: { get: jest.fn(), set: jest.fn() } }));
jest.mock("@/training/service", () => ({ trainingService: { state: jest.fn(), stage: jest.fn() } }));

const fr = strings.fr;
const en = strings.en;

const histoire = { id: "hist", name: "Histoire" };

let alert: jest.SpyInstance;
let sheet: jest.SpyInstance;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: "a@example.test", isAnonymous: false });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(levelService.get).mockReset().mockResolvedValue("course");
  jest.mocked(levelService.set).mockReset().mockImplementation(async (_id, level) => ({ status: "set", level }));
  jest.mocked(trainingService.stage).mockReset().mockResolvedValue("in_service");
  installFakeLibrary({ notebooks: [histoire], chapters: [], pages: [] });
  sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => undefined);
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => closeMenu());
  sheet.mockRestore();
  alert.mockRestore();
});

async function openNotebook(menuLabel: string = fr.notebook.menuLabel): Promise<void> {
  const app = renderRouter("./src/app", { initialUrl: `/notebook/${histoire.id}` });
  await app;
  await screen.findByLabelText(menuLabel);
}

function labels(): string[] {
  return screen.getAllByTestId(/^action-sheet-option-/).map((node) => node.props.accessibilityLabel as string);
}

async function press(item: string): Promise<void> {
  const option = (await screen.findAllByTestId(/^action-sheet-option-/)).find((node) => node.props.accessibilityLabel === item);
  expect(option).toBeDefined();
  await fireEvent.press(option!);
}

async function openLevels(menuLabel: string = fr.notebook.menuLabel, itemLabel: string = fr.notebook.level.label): Promise<void> {
  await fireEvent.press(await screen.findByLabelText(menuLabel));
  await press(itemLabel);
}

describe("the correction level in the menu of a notebook", () => {
  test("is offered by the menu and lists the three levels, the current one marked [10]", async () => {
    jest.mocked(levelService.get).mockResolvedValue("journal");
    await openNotebook();
    await openLevels();

    await waitFor(() => expect(levelService.get).toHaveBeenCalledWith(histoire.id));
    await waitFor(() =>
      expect(labels()).toEqual([fr.notebook.level.names.course, fr.notebook.level.current(fr.notebook.level.names.journal), fr.notebook.level.names.grammar]),
    );
  });

  test("moves the notebook to the journal level when a model is in service [10]", async () => {
    await openNotebook();
    await openLevels();
    await waitFor(() => expect(labels()).toContain(fr.notebook.level.names.journal));
    await press(fr.notebook.level.names.journal);

    await waitFor(() => expect(levelService.set).toHaveBeenCalledWith(histoire.id, "journal"));
    expect(alert).not.toHaveBeenCalled();
  });

  test.each(["not_started", "parent_pending", "test_needed", "training", "not_precise"] as const)(
    "says why when the stage is %s, and writes nothing [10]",
    async (stage) => {
      jest.mocked(trainingService.stage).mockResolvedValue(stage);
      await openNotebook();
      await openLevels();
      await waitFor(() => expect(labels()).toContain(fr.notebook.level.names.grammar));
      await press(fr.notebook.level.names.grammar);

      await waitFor(() => expect(alert).toHaveBeenCalledWith(fr.notebook.level.blocked[stage]));
      expect(levelService.set).not.toHaveBeenCalled();
    },
  );

  test("lets a notebook go back to the course level without a model [10]", async () => {
    jest.mocked(levelService.get).mockResolvedValue("journal");
    jest.mocked(trainingService.stage).mockResolvedValue("not_started");
    await openNotebook();
    await openLevels();
    await waitFor(() => expect(labels()).toContain(fr.notebook.level.names.course));
    await press(fr.notebook.level.names.course);

    await waitFor(() => expect(levelService.set).toHaveBeenCalledWith(histoire.id, "course"));
    expect(alert).not.toHaveBeenCalled();
  });

  test("writes nothing when the current level is chosen again [10]", async () => {
    jest.mocked(levelService.get).mockResolvedValue("journal");
    await openNotebook();
    await openLevels();
    await waitFor(() => expect(labels()).toContain(fr.notebook.level.current(fr.notebook.level.names.journal)));
    await press(fr.notebook.level.current(fr.notebook.level.names.journal));

    expect(levelService.set).not.toHaveBeenCalled();
  });

  test("tells the real reason when the server refuses a level the phone thought open [10]", async () => {
    jest.mocked(levelService.set).mockResolvedValue({ status: "requires_model" });
    await openNotebook();
    await openLevels();
    await waitFor(() => expect(labels()).toContain(fr.notebook.level.names.journal));
    jest.mocked(trainingService.stage).mockResolvedValue("not_precise");
    await press(fr.notebook.level.names.journal);

    await waitFor(() => expect(alert).toHaveBeenCalledWith(fr.notebook.level.blocked.not_precise));
  });

  test.each([
    ["offline", fr.notebook.level.offline],
    ["failed", fr.notebook.level.failed],
  ] as const)("says so when the change answers %s [10]", async (status, message) => {
    jest.mocked(levelService.set).mockResolvedValue({ status });
    await openNotebook();
    await openLevels();
    await waitFor(() => expect(labels()).toContain(fr.notebook.level.names.journal));
    await press(fr.notebook.level.names.journal);

    await waitFor(() => expect(alert).toHaveBeenCalledWith(message));
  });

  test("says so when the level or the stage cannot be loaded, and opens no menu [10]", async () => {
    jest.mocked(trainingService.stage).mockRejectedValue(new Error("training_stage"));
    await openNotebook();
    await openLevels();

    await waitFor(() => expect(alert).toHaveBeenCalledWith(fr.notebook.level.loadFailed));
    expect(screen.queryAllByTestId(/^action-sheet-option-/)).toHaveLength(0);
  });

  test("is written in English too, from the language files [14]", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    jest.mocked(levelService.get).mockResolvedValue("grammar");
    await openNotebook(en.notebook.menuLabel);
    await openLevels(en.notebook.menuLabel, en.notebook.level.label);

    await waitFor(() =>
      expect(labels()).toEqual([en.notebook.level.names.course, en.notebook.level.names.journal, en.notebook.level.current(en.notebook.level.names.grammar)]),
    );
  });
});
