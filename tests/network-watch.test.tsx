import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";

import { NetworkWatch } from "@/components/network-watch";
import { isOnline, setOnline } from "@/offline/network";

let mockNetwork: { isConnected?: boolean } = { isConnected: true };

jest.mock("expo-network", () => ({ useNetworkState: () => mockNetwork }));

function mount(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <NetworkWatch />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockNetwork = { isConnected: true };
  setOnline(true);
});

describe("the network flag of the app", () => {
  it("follows the state of the phone", async () => {
    const client = new QueryClient();
    mockNetwork = { isConnected: false };
    const view = await mount(client);
    expect(isOnline()).toBe(false);
    mockNetwork = { isConnected: true };
    await view.rerender(
      <QueryClientProvider client={client}>
        <NetworkWatch />
      </QueryClientProvider>,
    );
    expect(isOnline()).toBe(true);
  });

  it("takes an unknown state for a network, as the rest of the app does", async () => {
    mockNetwork = {};
    await mount(new QueryClient());
    expect(isOnline()).toBe(true);
  });

  it("asks every query to load again when the network returns, and not when it leaves", async () => {
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const view = await mount(client);
    expect(invalidate).not.toHaveBeenCalled();
    mockNetwork = { isConnected: false };
    await view.rerender(
      <QueryClientProvider client={client}>
        <NetworkWatch />
      </QueryClientProvider>,
    );
    expect(invalidate).not.toHaveBeenCalled();
    mockNetwork = { isConnected: true };
    await view.rerender(
      <QueryClientProvider client={client}>
        <NetworkWatch />
      </QueryClientProvider>,
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("goes back to online when the app is torn down", async () => {
    mockNetwork = { isConnected: false };
    const view = await mount(new QueryClient());
    expect(isOnline()).toBe(false);
    await view.unmount();
    expect(isOnline()).toBe(true);
  });
});
