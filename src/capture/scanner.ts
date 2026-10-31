import { File } from "expo-file-system";

import { documentScanner } from "../../modules/document-scanner";

export const SCAN_PAGE_MAX = 20;

export const MEASURE_PAGE_MAX = 30;

export type ScanResult = { status: "scanned"; uris: string[] } | { status: "cancelled" } | { status: "unavailable" } | { status: "failed" };

const SCAN_FILE = /^file:\/\/\/(?!.*\.\.)(?:[^/]+\/)+scans\/[A-Za-z0-9-]+\.jpg$/;

export function scanLimit(remaining: number): number {
  if (Number.isNaN(remaining) || remaining <= 0) {
    return 0;
  }
  return Math.min(Math.floor(remaining), SCAN_PAGE_MAX);
}

function isFileUri(value: unknown): value is string {
  return typeof value === "string" && SCAN_FILE.test(value);
}

function discard(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    return;
  }
}

export async function scannerAvailable(): Promise<boolean> {
  const scanner = documentScanner();
  if (scanner === null) {
    return false;
  }
  try {
    return (await scanner.isAvailable()) === true;
  } catch {
    return false;
  }
}

async function scan(limit: number, galleryImport: boolean): Promise<ScanResult> {
  const scanner = documentScanner();
  if (scanner === null || !(await scannerAvailable())) {
    return { status: "unavailable" };
  }
  let answer: unknown;
  try {
    answer = await scanner.scan(limit, galleryImport);
  } catch {
    return { status: "failed" };
  }
  const items: unknown[] = Array.isArray(answer) ? answer : [answer];
  const uris = items.filter(isFileUri);
  if (!Array.isArray(answer) || uris.length !== items.length || uris.length > limit) {
    uris.forEach(discard);
    return { status: "failed" };
  }
  return uris.length === 0 ? { status: "cancelled" } : { status: "scanned", uris };
}

export function scanPages({ limit }: { limit: number }): Promise<ScanResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > SCAN_PAGE_MAX) {
    return Promise.reject(new RangeError("limit"));
  }
  return scan(limit, false);
}

export function scanForMeasure(): Promise<ScanResult> {
  if (!__DEV__) {
    return Promise.resolve({ status: "unavailable" });
  }
  return scan(MEASURE_PAGE_MAX, true);
}
