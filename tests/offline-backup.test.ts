import { Platform } from "react-native";
import * as ts from "typescript";

import { closeAccountStores, openAccountStore } from "@/offline/store";

import { fakeFiles, fakeSecure, resetOffline } from "./fake-offline";

const mockExclusion = { native: null as null | { exclude: (uri: string) => boolean }, excluded: [] as string[] };

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => mockExclusion.native }));

const USER = "0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b";
const DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];

type Manifest = { manifest: { application?: { $: Record<string, string> }[] } };

const plugin = jest.requireActual("../plugins/with-no-backup") as {
  applyNoBackup: (manifest: Manifest) => Manifest;
  EXTRACTION_RULES: string;
  FULL_BACKUP_RULES: string;
};
const appConfig = JSON.parse(ts.sys.readFile(`${ts.sys.getCurrentDirectory()}/app.json`) ?? "{}") as {
  expo: { android: Record<string, unknown>; plugins: (string | [string, Record<string, unknown>])[] };
};
const swift = ts.sys.readFile(`${ts.sys.getCurrentDirectory()}/modules/backup-exclusion/ios/BackupExclusionModule.swift`) ?? "";
const moduleConfig = JSON.parse(
  ts.sys.readFile(`${ts.sys.getCurrentDirectory()}/modules/backup-exclusion/expo-module.config.json`) ?? "{}",
) as { platforms: string[] };

function excludedDomains(section: string, xml: string): string[] {
  const body = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? "";
  expect(body).not.toMatch(/<include/);
  return [...body.matchAll(/<exclude domain="([a-z_]+)" path="\." \/>/g)].map((match) => match[1]);
}

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = appConfig.expo.plugins.find((item) => (Array.isArray(item) ? item[0] : item) === name);
  return Array.isArray(entry) ? entry[1] : undefined;
}

beforeEach(async () => {
  await closeAccountStores();
  resetOffline();
  jest.replaceProperty(Platform, "OS", "ios");
  mockExclusion.excluded = [];
  mockExclusion.native = {
    exclude: (uri: string) => {
      mockExclusion.excluded.push(uri);
      expect(fakeFiles.size).toBe(0);
      return true;
    },
  };
});

describe("Android backups", () => {
  it("are turned off in the generated manifest, with rules that leave out every domain of the app", () => {
    const manifest = plugin.applyNoBackup({
      manifest: { application: [{ $: { "android:name": ".MainApplication", "android:allowBackup": "true" } }] },
    });

    expect(manifest.manifest.application?.[0].$).toEqual({
      "android:name": ".MainApplication",
      "android:allowBackup": "false",
      "android:fullBackupContent": "@xml/no_backup_full",
      "android:dataExtractionRules": "@xml/no_backup_extraction",
    });
  });

  it("leave out every domain from the cloud backup and from a transfer to another device", () => {
    expect(excludedDomains("cloud-backup", plugin.EXTRACTION_RULES).sort()).toEqual([...DOMAINS].sort());
    expect(excludedDomains("device-transfer", plugin.EXTRACTION_RULES).sort()).toEqual([...DOMAINS].sort());
    expect(excludedDomains("full-backup-content", plugin.FULL_BACKUP_RULES).sort()).toEqual([...DOMAINS].sort());
  });

  it("are configured by the app: no backup, the rules of the app instead of those of the secure store, SQLCipher on", () => {
    expect(appConfig.expo.android.allowBackup).toBe(false);
    expect(appConfig.expo.plugins).toContain("./plugins/with-no-backup");
    expect(pluginOptions("expo-secure-store")).toEqual({ configureAndroidBackup: false });
    expect(pluginOptions("expo-sqlite")).toEqual({ useSQLCipher: true });
  });

  it("need no native call: the store opens on Android without the iOS module", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    mockExclusion.native = null;

    await expect(openAccountStore(USER)).resolves.toBeDefined();
  });
});

describe("iCloud backups", () => {
  it("leave out the folder of the stores, marked before anything is written in it", async () => {
    await openAccountStore(USER);

    expect(mockExclusion.excluded).toEqual(["file:///docs/offline"]);
  });

  it("are checked: without the module, or when the mark does not hold, nothing is stored", async () => {
    mockExclusion.native = null;
    await expect(openAccountStore(USER)).rejects.toThrow("backup_exclusion_failed");

    mockExclusion.native = { exclude: () => false };
    await expect(openAccountStore(USER)).rejects.toThrow("backup_exclusion_failed");

    expect(fakeFiles.size).toBe(0);
    expect(fakeSecure.values.size).toBe(0);
  });

  it("are left out by the native module, which sets the mark and reads it back", () => {
    expect(moduleConfig.platforms).toEqual(["apple"]);
    expect(swift).toMatch(/isExcludedFromBackup = true/);
    expect(swift).toMatch(/removeAllCachedResourceValues\(\)\s+let read = try url\.resourceValues\(forKeys: \[\.isExcludedFromBackupKey\]\)/);
  });

  it("leave out the key: it never leaves this phone", async () => {
    await openAccountStore(USER);

    expect(fakeSecure.calls.length).toBeGreaterThan(0);
    for (const call of fakeSecure.calls) {
      expect(call.options).toEqual({ keychainAccessible: 6 });
    }
  });

  it("refuse any other platform", async () => {
    jest.replaceProperty(Platform, "OS", "web");

    await expect(openAccountStore(USER)).rejects.toThrow("backup_exclusion_failed");
  });
});
