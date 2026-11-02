import { leaveAccount, setOfflineSession, waitingPages } from "@/offline/accounts";
import { getMirrorStore } from "@/offline/mirror";
import { readQueue } from "@/offline/queue";
import { dismissNotices, getNotices, noteLost } from "@/offline/queue-state";
import type { OfflineSession } from "@/offline/session";
import { countWaitingFiles, wipeAccountStore, type AccountStore } from "@/offline/store";

import { OTHER_USER, USER } from "./offline-fixtures";

jest.mock("@/offline/store", () => ({ countWaitingFiles: jest.fn(), wipeAccountStore: jest.fn() }));
jest.mock("@/offline/mirror", () => ({ getMirrorStore: jest.fn() }));
jest.mock("@/offline/queue", () => ({ readQueue: jest.fn() }));

function openStore(userId: string, open = true): AccountStore {
  return { userId, isOpen: () => open } as unknown as AccountStore;
}

function fakeSession(): OfflineSession & { leave: jest.Mock } {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    foreground: jest.fn(),
    network: jest.fn(),
    leave: jest.fn(async () => 1),
  };
}

beforeEach(() => {
  setOfflineSession(null);
  dismissNotices();
  jest.mocked(getMirrorStore).mockReset().mockReturnValue(null);
  jest.mocked(readQueue).mockReset().mockResolvedValue([]);
  jest.mocked(countWaitingFiles).mockReset().mockReturnValue(0);
  jest.mocked(wipeAccountStore).mockReset().mockResolvedValue(0);
});

describe("the waiting pages told before an account is left", () => {
  it("are the waiting pages of its open store", async () => {
    jest.mocked(getMirrorStore).mockReturnValue(openStore(USER));
    jest.mocked(readQueue).mockResolvedValue([{}, {}, {}] as Awaited<ReturnType<typeof readQueue>>);
    jest.mocked(countWaitingFiles).mockReturnValue(1);

    expect(await waitingPages(USER)).toBe(3);
  });

  it("are the files of its queue when its store is not open, is another account's, or cannot be read", async () => {
    jest.mocked(countWaitingFiles).mockReturnValue(2);

    expect(await waitingPages(USER)).toBe(2);
    jest.mocked(getMirrorStore).mockReturnValue(openStore(OTHER_USER));
    expect(await waitingPages(USER)).toBe(2);
    jest.mocked(getMirrorStore).mockReturnValue(openStore(USER, false));
    expect(await waitingPages(USER)).toBe(2);
    jest.mocked(getMirrorStore).mockReturnValue(openStore(USER));
    jest.mocked(readQueue).mockRejectedValue(new Error("store_closed"));
    expect(await waitingPages(USER)).toBe(2);
    expect(countWaitingFiles).toHaveBeenCalledWith(USER);
  });

  it("are none when nothing can be counted", async () => {
    jest.mocked(countWaitingFiles).mockImplementation(() => {
      throw new Error("invalid_id");
    });

    expect(await waitingPages("../")).toBe(0);
  });
});

describe("leaving an account", () => {
  it("goes through the offline session when there is one, so that its store is never opened again", async () => {
    const session = fakeSession();
    setOfflineSession(session);

    await leaveAccount(USER);

    expect(session.leave).toHaveBeenCalledWith(USER);
    expect(wipeAccountStore).not.toHaveBeenCalled();
  });

  it("wipes the store itself when there is no session", async () => {
    await leaveAccount(USER);

    expect(wipeAccountStore).toHaveBeenCalledWith(USER);
  });

  it("drops the notices of the account left", async () => {
    noteLost(2);

    await leaveAccount(USER);

    expect(getNotices()).toEqual({ lost: 0, rejected: 0 });
  });

  it("never throws, whatever the wipe does", async () => {
    jest.mocked(wipeAccountStore).mockRejectedValue(new Error("busy"));
    await expect(leaveAccount(USER)).resolves.toBeUndefined();

    const session = fakeSession();
    session.leave.mockRejectedValue(new Error("busy"));
    setOfflineSession(session);
    await expect(leaveAccount(USER)).resolves.toBeUndefined();
  });
});
