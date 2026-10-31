import type { Allowance, BlockReason } from "./allowance";
import { SCAN_PAGE_MAX, scanLimit } from "./scanner";
import type { SendResult } from "./send-page";
import type { SharpnessCheck } from "./sharpness";

export type SeriesPage = { uri: string; pageId: string | null };

export type CheckedPage = { uri: string; sharpness: SharpnessCheck };

export type SeriesStop = { status: "limit"; reason: BlockReason } | { status: "network" | "failed" | "cancelled" };

export type SeriesRun = { sent: string[]; rejected: number; pending: SeriesPage[]; stop: SeriesStop | null };

export type PrepareDeps = {
  normalize: (uri: string) => Promise<string>;
  check: (uri: string) => Promise<SharpnessCheck>;
  discard: (uri: string) => void;
  onProgress?: (done: number, total: number) => void;
  alive?: () => boolean;
};

export type SendSeriesDeps = {
  send: (page: SeriesPage) => Promise<SendResult>;
  discard: (uri: string) => void;
  onProgress?: (index: number) => void;
  onSettled?: (page: SeriesPage) => void;
  alive?: () => boolean;
};

export function seriesLimit(allowance: Allowance | null | undefined): number {
  if (allowance === null || allowance === undefined) {
    return SCAN_PAGE_MAX;
  }
  return Math.max(1, scanLimit(allowance.remaining));
}

export async function prepareScans(uris: string[], deps: PrepareDeps): Promise<{ pages: CheckedPage[]; unreadable: number }> {
  const alive = deps.alive ?? (() => true);
  const pages: CheckedPage[] = [];
  let unreadable = 0;
  for (const [index, scanned] of uris.entries()) {
    if (!alive()) {
      uris.slice(index).forEach(deps.discard);
      pages.forEach((page) => deps.discard(page.uri));
      return { pages: [], unreadable };
    }
    deps.onProgress?.(index, uris.length);
    let ready: string;
    try {
      ready = await deps.normalize(scanned);
    } catch {
      deps.discard(scanned);
      unreadable += 1;
      continue;
    }
    deps.discard(scanned);
    if (!alive()) {
      deps.discard(ready);
      uris.slice(index + 1).forEach(deps.discard);
      pages.forEach((page) => deps.discard(page.uri));
      return { pages: [], unreadable };
    }
    let sharpness: SharpnessCheck;
    try {
      sharpness = await deps.check(ready);
    } catch {
      sharpness = "unchecked";
    }
    pages.push({ uri: ready, sharpness });
  }
  return { pages, unreadable };
}

export async function sendSeries(pages: SeriesPage[], deps: SendSeriesDeps): Promise<SeriesRun> {
  const alive = deps.alive ?? (() => true);
  const sent: string[] = [];
  let rejected = 0;
  for (const [index, page] of pages.entries()) {
    if (!alive()) {
      return { sent, rejected, pending: pages.slice(index), stop: { status: "cancelled" } };
    }
    deps.onProgress?.(index);
    const result = await deps.send(page);
    switch (result.status) {
      case "sent":
        sent.push(result.pageId);
        deps.discard(page.uri);
        deps.onSettled?.(page);
        break;
      case "photo":
      case "tooLarge":
        rejected += 1;
        deps.discard(page.uri);
        deps.onSettled?.(page);
        break;
      case "limit":
        return { sent, rejected, pending: stopped(pages, index, result.pageId), stop: { status: "limit", reason: result.reason } };
      case "network":
      case "failed":
        return { sent, rejected, pending: stopped(pages, index, result.pageId), stop: { status: result.status } };
    }
  }
  return { sent, rejected, pending: [], stop: null };
}

function stopped(pages: SeriesPage[], index: number, pageId: string | null): SeriesPage[] {
  const [current, ...rest] = pages.slice(index);
  return [{ uri: current.uri, pageId: pageId ?? current.pageId }, ...rest];
}

export function replaceAt(pages: CheckedPage[], index: number, page: CheckedPage): CheckedPage[] {
  return pages.map((existing, position) => (position === index ? page : existing));
}

export function destination(sent: string[], notebookId: string, chapterId: string | null): string | null {
  if (sent.length === 0) {
    return null;
  }
  if (sent.length === 1) {
    return `/page/${sent[0]}`;
  }
  return chapterId === null ? `/notebook/${notebookId}` : `/chapter/${chapterId}`;
}
