import { useLocales } from "expo-localization";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import { defaultAuthServices } from "@/auth/default-services";
import { strings } from "@/i18n";
import type { CreateNotebookResult } from "@/notebooks/notebooks";
import { notebookService } from "@/notebooks/service";
import { deferred } from "./fake-auth-client";
import { granted, installPermission } from "./fake-camera";
import { histoire, installFakeNotebooks, sciences } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
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
  notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn() },
}));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("@/capture/service", () => ({
  captureService: {
    allowance: jest.fn(async () => null),
    latestNotebookId: jest.fn(async () => null),
    send: jest.fn(),
  },
}));

const fr = strings.fr;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(notebookService.list).mockReset();
  jest.mocked(notebookService.get).mockReset();
  jest.mocked(notebookService.create).mockReset();
  installPermission(granted);
});

async function openApp(initialUrl = "/"): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl });
  await app;
  return () => app.getPathname();
}

async function openNewNotebookSheet(): Promise<() => string> {
  const pathname = await openApp();
  await fireEvent.press(await screen.findByText(fr.library.firstLaunch.create));
  expect(pathname()).toBe("/new-notebook");
  return pathname;
}

async function typeName(name: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText(fr.newNotebook.nameLabel), name);
}

test("shows the first launch screen when there is no notebook", async () => {
  installFakeNotebooks();
  await openApp();

  expect(await screen.findByText(fr.library.firstLaunch.title)).toBeTruthy();
  expect(screen.getByText(fr.library.firstLaunch.body)).toBeTruthy();
  expect(screen.getByText(fr.library.firstLaunch.create)).toBeTruthy();
  expect(screen.queryByText(fr.library.newNotebook)).toBeNull();
});

test("lists the notebooks with their number of pages and a way to add one", async () => {
  installFakeNotebooks([histoire, sciences]);
  await openApp();

  expect(await screen.findByText("Histoire")).toBeTruthy();
  expect(screen.getByText(fr.notebook.pageCount(8))).toBeTruthy();
  expect(screen.getByText("Sciences")).toBeTruthy();
  expect(screen.getByText(fr.notebook.pageCount(0))).toBeTruthy();
  expect(screen.getByText(fr.library.notebooks)).toBeTruthy();
  expect(screen.getByText(fr.library.newNotebook)).toBeTruthy();
  expect(screen.queryByText(fr.library.firstLaunch.title)).toBeNull();
});

test("opens a notebook from the list", async () => {
  installFakeNotebooks([histoire, sciences]);
  const pathname = await openApp();

  await fireEvent.press(await screen.findByText("Histoire"));

  expect(pathname()).toBe("/notebook/histoire-id");
  expect(await screen.findByText(fr.notebook.pageCount(8))).toBeTruthy();
});

test("opens the sheet from the first launch screen and from the list", async () => {
  installFakeNotebooks([histoire]);
  const pathname = await openApp();

  await fireEvent.press(await screen.findByText(fr.library.newNotebook));

  expect(pathname()).toBe("/new-notebook");
  expect(screen.getByText(fr.newNotebook.hint)).toBeTruthy();
});

test("does nothing when Create is pressed on an empty or blank name", async () => {
  installFakeNotebooks();
  const pathname = await openNewNotebookSheet();

  await fireEvent.press(screen.getByText(fr.newNotebook.create));
  await typeName("   ");
  await fireEvent.press(screen.getByText(fr.newNotebook.create));

  expect(notebookService.create).not.toHaveBeenCalled();
  expect(pathname()).toBe("/new-notebook");
  expect(screen.getByText(fr.newNotebook.hint)).toBeTruthy();
});

test("refuses a name already taken, with its message, and keeps the sheet open", async () => {
  installFakeNotebooks([histoire]);
  const pathname = await openApp();
  await fireEvent.press(await screen.findByText(fr.library.newNotebook));

  await typeName("Histoire");
  await fireEvent.press(screen.getByText(fr.newNotebook.create));

  expect(await screen.findByText(fr.newNotebook.duplicate("Histoire"))).toBeTruthy();
  expect(screen.queryByText(fr.newNotebook.hint)).toBeNull();
  expect(pathname()).toBe("/new-notebook");
});

test("lets the name be changed after a refusal, then creates the notebook", async () => {
  installFakeNotebooks([histoire]);
  const pathname = await openApp();
  await fireEvent.press(await screen.findByText(fr.library.newNotebook));
  await typeName("Histoire");
  await fireEvent.press(screen.getByText(fr.newNotebook.create));
  await screen.findByText(fr.newNotebook.duplicate("Histoire"));

  await typeName("Géographie");
  expect(screen.queryByText(fr.newNotebook.duplicate("Histoire"))).toBeNull();
  await fireEvent.press(screen.getByText(fr.newNotebook.create));

  await waitFor(() => expect(pathname()).toBe("/notebook/notebook-2"));
});

test("creates a notebook, opens it empty, and shows it in the library afterwards", async () => {
  installFakeNotebooks();
  const pathname = await openNewNotebookSheet();

  await typeName("Histoire");
  await fireEvent.press(screen.getByText(fr.newNotebook.create));

  await waitFor(() => expect(pathname()).toBe("/notebook/notebook-1"));
  expect(await screen.findByText(fr.notebook.pageCount(0))).toBeTruthy();
  expect(screen.getByText(fr.notebook.emptyTitle)).toBeTruthy();
  expect(screen.getByText(fr.notebook.emptyBody)).toBeTruthy();
  expect(screen.getByText(fr.common.scan)).toBeTruthy();

  await act(() => router.back());

  expect(pathname()).toBe("/");
  expect(await screen.findByText("Histoire")).toBeTruthy();
  expect(screen.queryByText(fr.library.firstLaunch.title)).toBeNull();
});

test("creates the notebook with the OK key of the keyboard", async () => {
  installFakeNotebooks();
  const pathname = await openNewNotebookSheet();

  await typeName("Histoire");
  await fireEvent(screen.getByLabelText(fr.newNotebook.nameLabel), "submitEditing");

  await waitFor(() => expect(pathname()).toBe("/notebook/notebook-1"));
});

test("creates only one notebook when Create is pressed twice quickly", async () => {
  installFakeNotebooks();
  const pending = deferred<CreateNotebookResult>();
  jest.mocked(notebookService.create).mockReturnValue(pending.promise);
  await openNewNotebookSheet();
  await typeName("Histoire");

  const submit = screen.getByLabelText(fr.newNotebook.nameLabel).props.onSubmitEditing as () => Promise<void>;

  await act(async () => {
    const attempts = [submit(), submit()];
    pending.resolve({ status: "created", notebook: { id: "notebook-1", name: "Histoire", pageCount: 0 } });
    await Promise.all(attempts);
  });

  expect(notebookService.create).toHaveBeenCalledTimes(1);
});

test("says so and keeps the sheet open when the notebook cannot be created", async () => {
  installFakeNotebooks();
  const pathname = await openNewNotebookSheet();
  jest.mocked(notebookService.create).mockResolvedValue({ status: "failed" });

  await typeName("Histoire");
  await fireEvent.press(screen.getByText(fr.newNotebook.create));

  expect(await screen.findByText(fr.newNotebook.failed)).toBeTruthy();
  expect(pathname()).toBe("/new-notebook");
});

test("offers to try again when the notebooks cannot be loaded", async () => {
  installFakeNotebooks([histoire]);
  jest.mocked(notebookService.list).mockRejectedValueOnce(new Error("offline"));
  await openApp();

  expect(await screen.findByText(fr.library.loadFailed)).toBeTruthy();
  await fireEvent.press(screen.getByText(fr.common.retry));

  expect(await screen.findByText("Histoire")).toBeTruthy();
  expect(screen.queryByText(fr.library.loadFailed)).toBeNull();
});

test("does not ask for notebooks before the account is ready", async () => {
  installFakeNotebooks([histoire]);
  jest.mocked(defaultAuthServices.ensureSession).mockReturnValue(new Promise(() => undefined));
  await openApp();

  expect(notebookService.list).not.toHaveBeenCalled();
  expect(screen.queryByText(fr.library.firstLaunch.title)).toBeNull();
});

test("goes back to the library from a notebook that does not exist", async () => {
  installFakeNotebooks([histoire]);
  const pathname = await openApp("/notebook/unknown");

  await waitFor(() => expect(pathname()).toBe("/"));
});

test("opens the capture screen from the Scan button of the library and of a notebook", async () => {
  installFakeNotebooks([histoire]);
  const pathname = await openApp();

  await fireEvent.press(await screen.findByText(fr.common.scan));
  expect(pathname()).toBe("/capture");
  await fireEvent.press(await screen.findByText(fr.common.cancel));

  await fireEvent.press(screen.getByText("Histoire"));
  await fireEvent.press(await screen.findByText(fr.common.scan));
  expect(pathname()).toBe("/capture");
});

test("writes every text of the notebook screens in English when the phone is in English", async () => {
  const en = strings.en;
  jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
  installFakeNotebooks();

  await openApp();
  expect(await screen.findByText(en.library.firstLaunch.title)).toBeTruthy();
  await fireEvent.press(screen.getByText(en.library.firstLaunch.create));
  expect(screen.getByText(en.newNotebook.hint)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText(en.newNotebook.nameLabel), "History");
  await fireEvent.press(screen.getByText(en.newNotebook.create));
  expect(await screen.findByText(en.notebook.pageCount(0))).toBeTruthy();
  expect(screen.getByText(en.notebook.emptyTitle)).toBeTruthy();
  expect(en.newNotebook.duplicate("History")).toContain("History");
  expect(en.notebook.pageCount(1)).toBe("1 page");
  expect(en.notebook.pageCount(2)).toBe("2 pages");
});

test.each([
  [0, "Aucune page"],
  [1, "1 page"],
  [2, "2 pages"],
])("counts %i pages in French as %s", (count, expected) => {
  expect(fr.notebook.pageCount(count)).toBe(expected);
});
