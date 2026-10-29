import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Alert, type AlertButton } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import type { Allowance } from "@/capture/allowance";
import { captureService } from "@/capture/service";
import { strings } from "@/i18n";
import type { ConsentFailure, ParentConfirmDone, ParentRequestFailure, TrainingState } from "@/training/api";
import { trainingService } from "@/training/service";
import { installFakeAccount } from "./fake-account-service";
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
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(async () => []), count: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn(), setPageType: jest.fn(), words: jest.fn(), correct: jest.fn(), edit: jest.fn(), alerts: jest.fn(async () => []), second: jest.fn(async () => null) },
}));
jest.mock("@/training/service", () => ({
  trainingService: { state: jest.fn(), saveAge: jest.fn(), grantConsent: jest.fn(), requestParent: jest.fn(), confirmParent: jest.fn(), revoke: jest.fn() },
}));

const fr = strings.fr;
const en = strings.en;

const registeredAllowance: Allowance = { isAnonymous: false, used: 9, max: 15, remaining: 6, resetsAt: null, blockedReason: null };

let state: TrainingState;
let alert: jest.SpyInstance;

function signedInAs(kind: "registered" | "anonymous") {
  jest
    .mocked(defaultAuthServices.ensureSession)
    .mockResolvedValue(
      kind === "registered"
        ? { status: "ready", userId: "test-user", email: "reader@example.test", isAnonymous: false }
        : { status: "ready", userId: "test-user", email: null, isAnonymous: true },
    );
}

beforeEach(() => {
  state = { birthYear: null, consent: "none" };
  jest.mocked(useLocales).mockReturnValue([{ ...phoneLocale("fr"), regionCode: "FR" }]);
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockReset().mockResolvedValue(registeredAllowance);
  jest.mocked(captureService.latestNotebookId).mockReset().mockResolvedValue(null);
  installFakeNotebooks([histoire]);
  installFakeAccount();
  signedInAs("registered");
  const service = jest.mocked(trainingService);
  service.state.mockReset().mockImplementation(async () => ({ ...state }));
  service.saveAge.mockReset().mockImplementation(async (_user, year) => {
    state = { ...state, birthYear: year };
    return { ok: true };
  });
  service.grantConsent.mockReset().mockImplementation(async () => {
    state = { ...state, consent: "user" };
    return { ok: true };
  });
  service.requestParent.mockReset().mockResolvedValue({ ok: true });
  service.confirmParent.mockReset().mockImplementation(async () => {
    state = { ...state, consent: "parent" };
    return { ok: true };
  });
  service.revoke.mockReset().mockImplementation(async () => {
    state = { ...state, consent: "none" };
    return { ok: true };
  });
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

afterEach(() => {
  alert.mockRestore();
});

async function open(url: string): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl: url });
  await app;
  return () => app.getPathname();
}

describe("the entry in the account", () => {
  test("a registered account opens the training from its account", async () => {
    const pathname = await open("/account");

    await fireEvent.press(await screen.findByText(fr.training.row));

    await waitFor(() => expect(pathname()).toBe("/training"));
  }, 30_000);

  test("an anonymous account is not offered the training", async () => {
    signedInAs("anonymous");
    await open("/account");
    await screen.findByText(fr.account.createAccount);

    expect(screen.queryByText(fr.training.row)).toBeNull();
  });
});

describe("the state of the training", () => {
  test("offers to start when nothing is given, and goes to the year of birth first", async () => {
    const pathname = await open("/training");

    expect(await screen.findByText(fr.training.intro)).toBeTruthy();
    expect(screen.queryByText(fr.training.withdraw)).toBeNull();
    await fireEvent.press(screen.getByText(fr.training.start));

    await waitFor(() => expect(pathname()).toBe("/training/age"));
  });

  test("goes straight to the consent once the year of birth is known, and keeps the parent's code reachable", async () => {
    state = { birthYear: 2012, consent: "none" };
    const pathname = await open("/training");

    await fireEvent.press(await screen.findByText(fr.training.start));
    await waitFor(() => expect(pathname()).toBe("/training/consent"));
  });

  test("offers the code of a parent once the year of birth is known", async () => {
    state = { birthYear: 2012, consent: "none" };
    const pathname = await open("/training");

    await fireEvent.press(await screen.findByText(fr.training.haveCode));
    await waitFor(() => expect(pathname()).toBe("/training/code"));
  });

  test("does not offer the code of a parent before the year of birth is known", async () => {
    await open("/training");
    await screen.findByText(fr.training.start);

    expect(screen.queryByText(fr.training.haveCode)).toBeNull();
  });

  test("says who agreed, and offers the withdrawal with what it erases", async () => {
    state = { birthYear: 1990, consent: "user" };
    await open("/training");
    expect(await screen.findByText(fr.training.byYou)).toBeTruthy();
    expect(screen.getByText(fr.training.withdrawNote)).toBeTruthy();
    expect(screen.queryByText(fr.training.start)).toBeNull();
  });

  test("says when a parent agreed", async () => {
    state = { birthYear: 2012, consent: "parent" };
    await open("/training");
    expect(await screen.findByText(fr.training.byParent)).toBeTruthy();
  });

  test("speaks English on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await open("/training");
    expect(await screen.findByText(en.training.intro)).toBeTruthy();
  });

  test("asks a registered account only: an anonymous one is sent to create an account", async () => {
    signedInAs("anonymous");
    await open("/training");
    expect(await screen.findByText(fr.training.registeredOnly)).toBeTruthy();
    expect(trainingService.state).not.toHaveBeenCalled();
  });

  test("says when the state cannot be loaded and loads it again", async () => {
    jest.mocked(trainingService.state).mockRejectedValueOnce(new Error("lost"));
    await open("/training");
    expect(await screen.findByText(fr.training.loadFailed)).toBeTruthy();

    await fireEvent.press(screen.getByText(fr.common.retry));
    expect(await screen.findByText(fr.training.intro)).toBeTruthy();
  });
});

describe("the withdrawal", () => {
  function confirm(): Promise<void> {
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    const button = buttons.find((each) => each.style === "destructive");
    return act(async () => {
      button?.onPress?.();
    });
  }

  test("asks for a confirmation that names what is erased, and does nothing before it", async () => {
    state = { birthYear: 1990, consent: "user" };
    await open("/training");

    await fireEvent.press(await screen.findByText(fr.training.withdraw));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe(fr.training.withdrawConfirmTitle);
    expect(alert.mock.calls[0][1]).toBe(fr.training.withdrawConfirmBody);
    expect(trainingService.revoke).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(buttons.map((button) => button.text)).toEqual([fr.common.cancel, fr.training.withdrawConfirm]);
  });

  test("withdraws, then shows the state without a consent", async () => {
    state = { birthYear: 1990, consent: "user" };
    await open("/training");
    await fireEvent.press(await screen.findByText(fr.training.withdraw));

    await confirm();

    expect(trainingService.revoke).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(fr.training.start)).toBeTruthy();
    expect(screen.queryByText(fr.training.byYou)).toBeNull();
  });

  test.each([
    ["offline", fr.training.errors.offline],
    ["failed", fr.training.errors.failed],
  ] as const)("says when the withdrawal did not work (%s) and keeps the consent shown", async (reason, message) => {
    jest.mocked(trainingService.revoke).mockResolvedValue({ ok: false, reason });
    state = { birthYear: 1990, consent: "user" };
    await open("/training");
    await fireEvent.press(await screen.findByText(fr.training.withdraw));

    await confirm();

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText(fr.training.byYou)).toBeTruthy();
  });
});

describe("the year of birth", () => {
  async function openAge() {
    const pathname = await open("/training/age");
    return pathname;
  }

  test("shows no proposed value", async () => {
    await openAge();
    expect(screen.getByLabelText(fr.training.ageLabel).props.value).toBe("");
  });

  test("writes the year with the country of the phone region, then goes to the consent", async () => {
    jest.mocked(useLocales).mockReturnValue([{ ...phoneLocale("fr"), regionCode: "BE" }]);
    const pathname = await openAge();

    await fireEvent.changeText(screen.getByLabelText(fr.training.ageLabel), "2012");
    await fireEvent.press(screen.getByText(fr.training.ageContinue));

    expect(trainingService.saveAge).toHaveBeenCalledWith("test-user", 2012, "BE");
    await waitFor(() => expect(pathname()).toBe("/training/consent"));
  });

  test("writes an empty country when the phone has no region", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
    await openAge();

    await fireEvent.changeText(screen.getByLabelText(fr.training.ageLabel), "1990");
    await fireEvent.press(screen.getByText(fr.training.ageContinue));

    expect(trainingService.saveAge).toHaveBeenCalledWith("test-user", 1990, "");
  });

  test.each(["", "12", "1899", "3000", "20x2", "19900"])("refuses %p without writing anything", async (text) => {
    await openAge();

    await fireEvent.changeText(screen.getByLabelText(fr.training.ageLabel), text);
    await fireEvent.press(screen.getByText(fr.training.ageContinue));

    expect(screen.getByText(fr.training.errors.invalidYear)).toBeTruthy();
    expect(trainingService.saveAge).not.toHaveBeenCalled();
  });

  test("goes on to the consent when the year was already written", async () => {
    jest.mocked(trainingService.saveAge).mockResolvedValue({ ok: false, reason: "already_set" });
    const pathname = await openAge();

    await fireEvent.changeText(screen.getByLabelText(fr.training.ageLabel), "2012");
    await fireEvent.press(screen.getByText(fr.training.ageContinue));

    await waitFor(() => expect(pathname()).toBe("/training/consent"));
  });

  test.each([
    ["out_of_range", fr.training.errors.invalidYear],
    ["not_registered", fr.training.errors.notRegistered],
    ["offline", fr.training.errors.offline],
    ["failed", fr.training.errors.failed],
  ] as const)("says why a write was refused (%s) and stays", async (reason, message) => {
    jest.mocked(trainingService.saveAge).mockResolvedValue({ ok: false, reason });
    const pathname = await openAge();

    await fireEvent.changeText(screen.getByLabelText(fr.training.ageLabel), "2012");
    await fireEvent.press(screen.getByText(fr.training.ageContinue));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(pathname()).toBe("/training/age");
  });
});

describe("the consent", () => {
  async function openConsent() {
    state = { birthYear: 1990, consent: "none" };
    return open("/training/consent");
  }

  test("shows the whole text of the consent", async () => {
    await openConsent();
    expect(screen.getByText(fr.training.consentTitle)).toBeTruthy();
    for (const section of fr.training.consentSections) {
      expect(screen.getByText(section)).toBeTruthy();
    }
  });

  test("shows the English text on an English phone", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openConsent();
    for (const section of en.training.consentSections) {
      expect(screen.getByText(section)).toBeTruthy();
    }
  });

  test("writes the consent and comes back to the state", async () => {
    const pathname = await openConsent();

    await fireEvent.press(screen.getByText(fr.training.agree));

    expect(trainingService.grantConsent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pathname()).toBe("/training"));
    expect(await screen.findByText(fr.training.byYou)).toBeTruthy();
  });

  test("writes nothing when the user is not ready", async () => {
    const pathname = await openConsent();

    await fireEvent.press(screen.getByText(fr.training.notNow));

    expect(trainingService.grantConsent).not.toHaveBeenCalled();
    await waitFor(() => expect(pathname()).toBe("/training"));
  });

  test("asks for a parent when the base says the user is under age", async () => {
    jest.mocked(trainingService.grantConsent).mockResolvedValue({ ok: false, reason: "under_age" });
    const pathname = await openConsent();

    await fireEvent.press(screen.getByText(fr.training.agree));

    await waitFor(() => expect(pathname()).toBe("/training/parent"));
  });

  test("treats a consent that was already active as given", async () => {
    jest.mocked(trainingService.grantConsent).mockResolvedValue({ ok: false, reason: "already_active" });
    const pathname = await openConsent();

    await fireEvent.press(screen.getByText(fr.training.agree));

    await waitFor(() => expect(pathname()).toBe("/training"));
  });

  test("goes back to the year of birth when the base has none", async () => {
    jest.mocked(trainingService.grantConsent).mockResolvedValue({ ok: false, reason: "age_missing" });
    const pathname = await openConsent();

    await fireEvent.press(screen.getByText(fr.training.agree));

    await waitFor(() => expect(pathname()).toBe("/training/age"));
  });

  test.each([
    ["offline", fr.training.errors.offline],
    ["not_registered", fr.training.errors.notRegistered],
    ["failed", fr.training.errors.failed],
  ] as const satisfies readonly (readonly [ConsentFailure, string])[])("says why the consent was refused (%s) and stays", async (reason, message) => {
    jest.mocked(trainingService.grantConsent).mockResolvedValue({ ok: false, reason });
    const pathname = await openConsent();

    await fireEvent.press(screen.getByText(fr.training.agree));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(pathname()).toBe("/training/consent");
  });
});

describe("the request to a parent", () => {
  async function openParent() {
    state = { birthYear: 2012, consent: "none" };
    return open("/training/parent");
  }

  test("sends the address typed and goes to the code", async () => {
    const pathname = await openParent();

    await fireEvent.changeText(screen.getByLabelText(fr.training.parentEmailLabel), "parent@example.test");
    await fireEvent.press(screen.getByText(fr.training.sendCode));

    expect(trainingService.requestParent).toHaveBeenCalledWith("parent@example.test");
    await waitFor(() => expect(pathname()).toBe("/training/code"));
  });

  test("keeps the code reachable for a parent who already wrote", async () => {
    const pathname = await openParent();

    await fireEvent.press(screen.getByText(fr.training.alreadyHaveCode));

    expect(trainingService.requestParent).not.toHaveBeenCalled();
    await waitFor(() => expect(pathname()).toBe("/training/code"));
  });

  test.each([
    ["invalid_email", fr.training.errors.invalidEmail],
    ["same_email", fr.training.errors.sameEmail],
    ["send_limit", fr.training.errors.sendLimit],
    ["unavailable", fr.training.errors.unavailable],
    ["send_failed", fr.training.errors.sendFailed],
    ["not_registered", fr.training.errors.notRegistered],
    ["offline", fr.training.errors.offline],
    ["failed", fr.training.errors.failed],
  ] as const satisfies readonly (readonly [ParentRequestFailure, string])[])("says why the request was refused (%s) and stays", async (reason, message) => {
    jest.mocked(trainingService.requestParent).mockResolvedValue({ ok: false, reason });
    const pathname = await openParent();

    await fireEvent.changeText(screen.getByLabelText(fr.training.parentEmailLabel), "parent@example.test");
    await fireEvent.press(screen.getByText(fr.training.sendCode));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(pathname()).toBe("/training/parent");
  });

  test("goes to the consent when the base says the user does not need a parent", async () => {
    jest.mocked(trainingService.requestParent).mockResolvedValue({ ok: false, reason: "not_under_age" });
    const pathname = await openParent();

    await fireEvent.changeText(screen.getByLabelText(fr.training.parentEmailLabel), "parent@example.test");
    await fireEvent.press(screen.getByText(fr.training.sendCode));

    await waitFor(() => expect(pathname()).toBe("/training/consent"));
  });

  test("goes back to the state when a consent is already active", async () => {
    jest.mocked(trainingService.requestParent).mockResolvedValue({ ok: false, reason: "already_active" });
    const pathname = await openParent();

    await fireEvent.changeText(screen.getByLabelText(fr.training.parentEmailLabel), "parent@example.test");
    await fireEvent.press(screen.getByText(fr.training.sendCode));

    await waitFor(() => expect(pathname()).toBe("/training"));
  });

  test("goes back to the year of birth when the base has none", async () => {
    jest.mocked(trainingService.requestParent).mockResolvedValue({ ok: false, reason: "age_missing" });
    const pathname = await openParent();

    await fireEvent.changeText(screen.getByLabelText(fr.training.parentEmailLabel), "parent@example.test");
    await fireEvent.press(screen.getByText(fr.training.sendCode));

    await waitFor(() => expect(pathname()).toBe("/training/age"));
  });
});

describe("the code of a parent", () => {
  async function openCode() {
    state = { birthYear: 2012, consent: "none" };
    return open("/training/code");
  }

  function typeCode(code: string) {
    return fireEvent.changeText(screen.getByLabelText(fr.training.codeLabel), code);
  }

  test("checks the code at the sixth digit, without a button, then shows the parent's consent", async () => {
    const pathname = await openCode();

    await typeCode("12345");
    expect(trainingService.confirmParent).not.toHaveBeenCalled();
    await typeCode("123456");

    expect(trainingService.confirmParent).toHaveBeenCalledWith("123456");
    await waitFor(() => expect(pathname()).toBe("/training"));
    expect(await screen.findByText(fr.training.byParent)).toBeTruthy();
  });

  test("says how many tries are left after a wrong code and empties the field", async () => {
    jest.mocked(trainingService.confirmParent).mockResolvedValue({ ok: false, reason: "wrong_code", attemptsLeft: 2 });
    await openCode();

    await typeCode("123456");

    expect(await screen.findByText(fr.training.errors.wrongCode(2))).toBeTruthy();
    expect(screen.getByLabelText(fr.training.codeLabel).props.value).toBe("");
  });

  test.each([
    ["expired", fr.training.errors.codeExpired],
    ["no_request", fr.training.errors.codeExpired],
  ] as const)("says when the code is no longer valid (%s) and offers a new one", async (reason, message) => {
    jest.mocked(trainingService.confirmParent).mockResolvedValue({ ok: false, reason, attemptsLeft: null });
    const pathname = await openCode();

    await typeCode("123456");

    expect(await screen.findByText(message)).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.training.askAgain));
    await waitFor(() => expect(pathname()).toBe("/training/parent"));
  });

  test("treats the fifth wrong code as a code that is gone, and offers a new one", async () => {
    jest.mocked(trainingService.confirmParent).mockResolvedValue({ ok: false, reason: "wrong_code", attemptsLeft: 0 });
    const pathname = await openCode();

    await typeCode("123456");

    expect(await screen.findByText(fr.training.errors.codeExpired)).toBeTruthy();
    expect(screen.queryByText(fr.training.errors.wrongCode(0))).toBeNull();
    await fireEvent.press(screen.getByText(fr.training.askAgain));
    await waitFor(() => expect(pathname()).toBe("/training/parent"));
  });

  test("goes to the consent when the base says the user does not need a parent", async () => {
    jest.mocked(trainingService.confirmParent).mockResolvedValue({ ok: false, reason: "not_under_age", attemptsLeft: null });
    const pathname = await openCode();

    await typeCode("123456");

    await waitFor(() => expect(pathname()).toBe("/training/consent"));
  });

  test("goes back to the state when a consent is already active", async () => {
    jest.mocked(trainingService.confirmParent).mockResolvedValue({ ok: false, reason: "already_active", attemptsLeft: null });
    const pathname = await openCode();

    await typeCode("123456");

    await waitFor(() => expect(pathname()).toBe("/training"));
  });

  test.each([
    ["offline", fr.training.errors.offline],
    ["failed", fr.training.errors.failed],
    ["not_registered", fr.training.errors.notRegistered],
  ] as const)("says why the confirmation did not work (%s)", async (reason, message) => {
    jest.mocked(trainingService.confirmParent).mockResolvedValue({ ok: false, reason, attemptsLeft: null });
    await openCode();

    await typeCode("123456");

    expect(await screen.findByText(message)).toBeTruthy();
  });
});

describe("every phrase of the training exists in both languages", () => {
  function shape(value: unknown): unknown {
    if (typeof value === "string") return "string";
    if (typeof value === "function") return "function";
    if (Array.isArray(value)) return value.map(shape);
    if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, shape(each)]));
    return typeof value;
  }

  test("English and French hold the same keys, and the same number of consent sections", () => {
    expect(shape(en.training)).toEqual(shape(fr.training));
    expect(en.training.consentSections).toHaveLength(6);
  });
});
