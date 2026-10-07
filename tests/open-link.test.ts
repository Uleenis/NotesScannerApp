import { Linking } from "react-native";

import { openLink } from "@/lib/open-link";

afterEach(() => {
  jest.restoreAllMocks();
});

test("opens the address it is given", () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

  openLink("https://example.test/terms");

  expect(open).toHaveBeenCalledWith("https://example.test/terms");
});

test("handles the failure of an address that cannot be opened, so nothing is left unhandled", () => {
  const handle = jest.fn();
  jest.spyOn(Linking, "openURL").mockReturnValue({ catch: handle } as unknown as Promise<true>);

  openLink("https://example.test/terms");

  expect(handle).toHaveBeenCalledTimes(1);
});

test("a rejection of the browser does not reach the caller", async () => {
  jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));

  expect(() => openLink("https://example.test/terms")).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
