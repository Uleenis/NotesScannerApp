import { useLocales } from "expo-localization";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Linking } from "react-native";

import { defaultAuthServices } from "@/auth/default-services";
import { strings } from "@/i18n";
import { legalLinks } from "@/lib/legal-links";
import { captureService } from "@/capture/service";
import { installFakeAccount, refused } from "./fake-account-service";
import { histoire, installFakeNotebooks } from "./fake-notebook-service";
import { phoneLocale } from "./phone-locale";

jest.mock("expo-localization", () => ({ useLocales: jest.fn() }));
jest.mock("expo-network", () => ({ useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock("expo-camera", () => require("./fake-camera").cameraModule);
jest.mock("@/auth/default-services", () => ({
  defaultAuthServices: { watch: () => () => undefined, ensureSession: jest.fn(), syncLanguage: jest.fn() },
}));
jest.mock("@/auth/account-service", () => require("./account-service-module").accountServiceModule);
jest.mock("@/notebooks/service", () => ({ notebookService: { list: jest.fn(), get: jest.fn(), create: jest.fn() } }));
jest.mock("@/capture/service", () => ({
  captureService: { allowance: jest.fn(), latestNotebookId: jest.fn(), send: jest.fn() },
}));
jest.mock("@/pages/service", () => ({
  pageService: { list: jest.fn(async () => []), count: jest.fn(), get: jest.fn(), photoUrl: jest.fn(), startReading: jest.fn() },
}));

const fr = strings.fr;
const en = strings.en;

let service: ReturnType<typeof installFakeAccount>;

beforeEach(() => {
  jest.mocked(useLocales).mockReturnValue([phoneLocale("fr")]);
  jest.mocked(defaultAuthServices.ensureSession).mockResolvedValue({ status: "ready", userId: "test-user", email: null, isAnonymous: true });
  jest.mocked(defaultAuthServices.syncLanguage).mockResolvedValue(true);
  jest.mocked(captureService.allowance).mockResolvedValue(null);
  jest.mocked(captureService.latestNotebookId).mockResolvedValue(null);
  installFakeNotebooks([histoire]);
  service = installFakeAccount();
});

async function openSignIn(): Promise<() => string> {
  const app = renderRouter("./src/app", { initialUrl: "/sign-in" });
  await app;
  return () => app.getPathname();
}

function typeEmail(address: string) {
  return fireEvent.changeText(screen.getByLabelText(fr.signIn.emailLabel), address);
}

describe("creating an account", () => {
  test("shows the title, the sentence, the field, the button and the way to sign in", async () => {
    await openSignIn();

    expect(screen.getByText(fr.signIn.signUpTitle)).toBeTruthy();
    expect(screen.getByText(fr.signIn.signUpBody)).toBeTruthy();
    expect(screen.getByLabelText(fr.signIn.emailLabel).props.placeholder).toBe(fr.signIn.emailPlaceholder);
    expect(screen.getByText(fr.signIn.receiveCode)).toBeTruthy();
    expect(screen.getByText(fr.signIn.haveAccount, { exact: false })).toBeTruthy();
    expect(screen.getByText(fr.signIn.signInLink)).toBeTruthy();
  });

  test("has an e-mail field with the right keyboard and no mistaken capital or correction", async () => {
    await openSignIn();

    const field = screen.getByLabelText(fr.signIn.emailLabel);
    expect(field.props.keyboardType).toBe("email-address");
    expect(field.props.autoCapitalize).toBe("none");
    expect(field.props.autoCorrect).toBe(false);
    expect(field.props.textContentType).toBe("emailAddress");
  });

  test("shows the sentence about the terms and the privacy policy, with a link for each", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await openSignIn();

    expect(screen.getByText(fr.signIn.legalBefore, { exact: false })).toBeTruthy();
    await fireEvent.press(screen.getByText(fr.signIn.terms));
    expect(open).toHaveBeenLastCalledWith(legalLinks.terms);
    await fireEvent.press(screen.getByText(fr.signIn.privacy));
    expect(open).toHaveBeenLastCalledWith(legalLinks.privacy);
    expect(open).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });

  test("asks for a code with the address given, then shows the code screen", async () => {
    const pathname = await openSignIn();
    await typeEmail("reader@example.test");

    await fireEvent.press(screen.getByText(fr.signIn.receiveCode));

    expect(service.startSignUp).toHaveBeenCalledTimes(1);
    expect(service.startSignUp).toHaveBeenCalledWith("reader@example.test");
    expect(service.startSignIn).not.toHaveBeenCalled();
    await waitFor(() => expect(pathname()).toBe("/sign-in/code"));
    expect(await screen.findByText(fr.code.title)).toBeTruthy();
    expect(screen.getByText(fr.code.body("reader@example.test"))).toBeTruthy();
  });

  test("sends only one request when the button is pressed twice in a row", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    service.startSignUp.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const pathname = await openSignIn();
    await typeEmail("reader@example.test");

    const button = screen.getByRole("button", { name: fr.signIn.receiveCode });
    await act(async () => {
      button.props.onClick({ nativeEvent: {} });
      button.props.onClick({ nativeEvent: {} });
    });
    await act(async () => finish({ ok: true }));

    expect(service.startSignUp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pathname()).toBe("/sign-in/code"));
  });

  test.each([
    ["invalid_email", fr.accountErrors.invalid_email],
    ["exists", fr.accountErrors.exists],
    ["too_many", fr.accountErrors.too_many],
    ["offline", fr.accountErrors.offline],
    ["failed", fr.accountErrors.failed],
  ] as const)("says why no code was sent: %s", async (reason, message) => {
    service.startSignUp.mockResolvedValue(refused(reason));
    const pathname = await openSignIn();
    await typeEmail("reader@example.test");

    await fireEvent.press(screen.getByText(fr.signIn.receiveCode));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(pathname()).toBe("/sign-in");
  });

  test("clears the message once the address is edited", async () => {
    service.startSignUp.mockResolvedValue(refused("invalid_email"));
    await openSignIn();
    await typeEmail("reader");
    await fireEvent.press(screen.getByText(fr.signIn.receiveCode));
    expect(await screen.findByText(fr.accountErrors.invalid_email)).toBeTruthy();

    await typeEmail("reader@example.test");

    expect(screen.queryByText(fr.accountErrors.invalid_email)).toBeNull();
  });

  test("is written in English on a phone in English", async () => {
    jest.mocked(useLocales).mockReturnValue([phoneLocale("en")]);
    await openSignIn();

    expect(screen.getByText(en.signIn.signUpTitle)).toBeTruthy();
    expect(screen.getByText(en.signIn.receiveCode)).toBeTruthy();
  });

  test("closes with Cancel", async () => {
    const pathname = await openSignIn();

    await fireEvent.press(screen.getByText(fr.common.cancel));

    await waitFor(() => expect(pathname()).toBe("/"));
  });
});

describe("signing in to an existing account", () => {
  async function switchToSignIn() {
    await fireEvent.press(screen.getByText(fr.signIn.signInLink));
  }

  test("shows the same screen with the words of a sign-in, and a way back", async () => {
    await openSignIn();

    await switchToSignIn();

    expect(screen.getByText(fr.signIn.signInTitle)).toBeTruthy();
    expect(screen.getByText(fr.signIn.signInBody)).toBeTruthy();
    expect(screen.getByText(fr.signIn.noAccount, { exact: false })).toBeTruthy();
    expect(screen.queryByText(fr.signIn.signUpTitle)).toBeNull();

    await fireEvent.press(screen.getByText(fr.signIn.signUpLink));
    expect(screen.getByText(fr.signIn.signUpTitle)).toBeTruthy();
  });

  test("keeps the address typed when switching", async () => {
    await openSignIn();
    await typeEmail("reader@example.test");

    await switchToSignIn();

    expect(screen.getByLabelText(fr.signIn.emailLabel).props.value).toBe("reader@example.test");
  });

  test("asks for a sign-in code, saying that this phone has an anonymous account, then shows the code screen", async () => {
    const pathname = await openSignIn();
    await switchToSignIn();
    await typeEmail("reader@example.test");

    await fireEvent.press(screen.getByText(fr.signIn.receiveCode));

    expect(service.startSignIn).toHaveBeenCalledTimes(1);
    expect(service.startSignIn).toHaveBeenCalledWith("reader@example.test");
    expect(service.startSignUp).not.toHaveBeenCalled();
    await waitFor(() => expect(pathname()).toBe("/sign-in/code"));
  });

  test.each([
    ["unknown_account", fr.accountErrors.unknown_account],
    ["too_many", fr.accountErrors.too_many],
  ] as const)("says why no code was sent: %s", async (reason, message) => {
    service.startSignIn.mockResolvedValue(refused(reason));
    const pathname = await openSignIn();
    await switchToSignIn();
    await typeEmail("reader@example.test");

    await fireEvent.press(screen.getByText(fr.signIn.receiveCode));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(pathname()).toBe("/sign-in");
  });
});
