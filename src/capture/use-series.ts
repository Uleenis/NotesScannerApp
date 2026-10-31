import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";

import { useStrings } from "@/i18n";
import { confirmDeletion } from "@/lib/action-menu";
import { blockForReason, type Block, type BlockReason } from "./allowance";
import type { PageSource } from "./api";
import { pickImages, type PickResult } from "./importer";
import { limitParams } from "./limit-route";
import { useSendPage } from "./queries";
import { scanPages, type ScanResult } from "./scanner";
import type { SendResult } from "./send-page";
import { captureService } from "./service";
import { checkImports, destination, prepareScans, replaceAt, sendSeries, type CheckedPage, type SeriesPage } from "./series";

export type Target = { notebookId: string; chapterId: string | null };

type Candidate = { original: string; turns: number; kept: string | null };

export type Phase =
  | { kind: "idle"; notice: "unavailable" | "failed" | "importFailed" | null; leftOut: number }
  | { kind: "scanning" }
  | { kind: "picking" }
  | { kind: "reviewing"; page: number; total: number; uri: string; turning: boolean; problem: boolean }
  | { kind: "preparing"; page: number; total: number }
  | { kind: "blurry" }
  | { kind: "sending"; page: number; total: number }
  | { kind: "interrupted"; pending: number }
  | { kind: "ended"; notSent: number; block: Block | null; leftOut: number; next: string | null };

const IDLE: Phase = { kind: "idle", notice: null, leftOut: 0 };

export function useSeries(target: Target, limit: number, ready: boolean) {
  const t = useStrings();
  const send = useSendPage();
  const [phase, setPhase] = useState<Phase>(IDLE);
  const [pages, setPages] = useState<CheckedPage[]>([]);

  const targetNow = useRef(target);
  targetNow.current = target;
  const mounted = useRef(true);
  const cancelled = useRef(false);
  const busy = useRef(false);
  const launched = useRef(false);
  const held = useRef<string[]>([]);
  const checked = useRef<CheckedPage[]>([]);
  const pending = useRef<SeriesPage[]>([]);
  const sentIds = useRef<string[]>([]);
  const leftOut = useRef(0);
  const processed = useRef(0);
  const total = useRef(0);
  const sentTo = useRef<Target>(target);
  const inFlight = useRef<string | null>(null);
  const mode = useRef<PageSource>("camera");
  const candidates = useRef<Candidate[]>([]);
  const accepted = useRef<string[]>([]);
  const reviewAt = useRef(0);
  const replacing = useRef<number | null>(null);

  const alive = () => mounted.current && !cancelled.current;

  function discardHeld() {
    const flying = inFlight.current;
    held.current.filter((uri) => uri !== flying).forEach(captureService.discardPhoto);
    held.current = flying === null ? [] : [flying];
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discardHeld();
    };
  }, []);

  function syncHeld() {
    held.current = [
      ...checked.current.map((page) => page.uri),
      ...accepted.current,
      ...candidates.current.slice(reviewAt.current).flatMap((item) => (item.kept === null ? [item.original] : [item.original, item.kept])),
    ];
  }

  function keep(list: CheckedPage[]) {
    checked.current = list;
    held.current = list.map((page) => page.uri);
    setPages(list);
  }

  function resetSeries() {
    sentIds.current = [];
    leftOut.current = 0;
    processed.current = 0;
    total.current = 0;
    pending.current = [];
    keep([]);
  }

  async function startScan(count: number, replace: number | null) {
    if (busy.current || !alive()) {
      return;
    }
    busy.current = true;
    if (replace === null) {
      sentTo.current = targetNow.current;
      mode.current = "camera";
    }
    setPhase({ kind: "scanning" });
    let result: ScanResult;
    try {
      result = await scanPages({ limit: count });
    } catch {
      result = { status: "failed" };
    }
    if (!alive()) {
      if (result.status === "scanned") {
        result.uris.forEach(captureService.discardPhoto);
      }
      busy.current = false;
      return;
    }
    if (result.status === "scanned") {
      await prepare(result.uris, replace);
      return;
    }
    busy.current = false;
    if (replace !== null) {
      setPhase({ kind: "blurry" });
    } else if (result.status === "unavailable" || result.status === "failed") {
      setPhase({ kind: "idle", notice: result.status, leftOut: 0 });
    } else {
      setPhase(IDLE);
    }
  }

  async function prepare(uris: string[], replace: number | null) {
    if (replace === null) {
      resetSeries();
    }
    const prepared = await prepareScans(uris, {
      normalize: captureService.prepareScan,
      check: captureService.checkSharpness,
      discard: captureService.discardPhoto,
      onProgress: (done, count) => {
        if (alive()) {
          setPhase({ kind: "preparing", page: done + 1, total: count });
        }
      },
      alive,
    });
    busy.current = false;
    if (!alive()) {
      prepared.pages.forEach((page) => captureService.discardPhoto(page.uri));
      return;
    }
    if (replace !== null) {
      const old = checked.current[replace];
      if (prepared.pages.length === 1 && old !== undefined) {
        captureService.discardPhoto(old.uri);
        keep(replaceAt(checked.current, replace, prepared.pages[0]));
      } else {
        prepared.pages.forEach((page) => captureService.discardPhoto(page.uri));
      }
    } else {
      leftOut.current = prepared.unreadable;
      keep(prepared.pages);
    }
    proceed();
  }

  async function startImport(count: number, replace: number | null) {
    if (busy.current || !alive()) {
      return;
    }
    busy.current = true;
    if (replace === null) {
      sentTo.current = targetNow.current;
      mode.current = "import";
    }
    setPhase({ kind: "picking" });
    let result: PickResult;
    try {
      result = await pickImages({ limit: count });
    } catch {
      result = { status: "failed" };
    }
    busy.current = false;
    if (!alive()) {
      if (result.status === "picked") {
        result.uris.forEach(captureService.discardPhoto);
      }
      return;
    }
    if (result.status !== "picked") {
      if (replace !== null) {
        setPhase({ kind: "blurry" });
      } else {
        setPhase(result.status === "failed" ? { kind: "idle", notice: "importFailed", leftOut: 0 } : IDLE);
      }
      return;
    }
    if (replace === null) {
      resetSeries();
      leftOut.current = result.rejected;
    }
    replacing.current = replace;
    accepted.current = [];
    candidates.current = result.uris.map((original) => ({ original, turns: 0, kept: null }));
    reviewAt.current = 0;
    syncHeld();
    await enter(0);
  }

  function showReview(turning: boolean, problem: boolean) {
    const item = candidates.current[reviewAt.current];
    if (item !== undefined && item.kept !== null) {
      setPhase({ kind: "reviewing", page: reviewAt.current + 1, total: candidates.current.length, uri: item.kept, turning, problem });
    }
  }

  async function enter(from: number) {
    let index = from;
    while (index < candidates.current.length) {
      reviewAt.current = index;
      const item = candidates.current[index];
      busy.current = true;
      setPhase({ kind: "preparing", page: index + 1, total: candidates.current.length });
      let prepared: string | null;
      try {
        prepared = await captureService.prepareImport(item.original, item.turns);
      } catch {
        prepared = null;
      }
      busy.current = false;
      if (!alive()) {
        if (prepared !== null) {
          captureService.discardPhoto(prepared);
        }
        return;
      }
      if (prepared !== null) {
        item.kept = prepared;
        syncHeld();
        showReview(false, false);
        return;
      }
      captureService.discardPhoto(item.original);
      if (replacing.current === null) {
        leftOut.current += 1;
      }
      index += 1;
      reviewAt.current = index;
      syncHeld();
    }
    await finishReview();
  }

  async function finishReview() {
    const list = accepted.current;
    const replace = replacing.current;
    accepted.current = [];
    candidates.current = [];
    reviewAt.current = 0;
    if (list.length === 0) {
      syncHeld();
      setPhase(replace !== null ? { kind: "blurry" } : { kind: "idle", notice: null, leftOut: leftOut.current });
      return;
    }
    busy.current = true;
    held.current = [...checked.current.map((page) => page.uri), ...list];
    const done = await checkImports(list, {
      check: captureService.checkSharpness,
      onProgress: (index, count) => {
        if (alive()) {
          setPhase({ kind: "preparing", page: index + 1, total: count });
        }
      },
      alive,
    });
    busy.current = false;
    if (!alive()) {
      list.forEach(captureService.discardPhoto);
      return;
    }
    if (replace !== null) {
      const old = checked.current[replace];
      if (done.length === 1 && old !== undefined) {
        captureService.discardPhoto(old.uri);
        keep(replaceAt(checked.current, replace, done[0]));
      } else {
        list.forEach(captureService.discardPhoto);
      }
    } else {
      keep(done);
    }
    proceed();
  }

  async function rotate() {
    const item = candidates.current[reviewAt.current];
    if (busy.current || item === undefined || item.kept === null) {
      return;
    }
    busy.current = true;
    showReview(true, false);
    const turns = (item.turns + 1) % 4;
    let turned: string | null;
    try {
      turned = await captureService.prepareImport(item.original, turns);
    } catch {
      turned = null;
    }
    busy.current = false;
    if (!alive()) {
      if (turned !== null) {
        captureService.discardPhoto(turned);
      }
      return;
    }
    if (turned === null) {
      showReview(false, true);
      return;
    }
    const old = item.kept;
    item.kept = turned;
    item.turns = turns;
    syncHeld();
    captureService.discardPhoto(old);
    showReview(false, false);
  }

  function keepCurrent() {
    const item = candidates.current[reviewAt.current];
    if (busy.current || item === undefined || item.kept === null) {
      return;
    }
    accepted.current = [...accepted.current, item.kept];
    const next = reviewAt.current + 1;
    reviewAt.current = next;
    syncHeld();
    captureService.discardPhoto(item.original);
    void enter(next);
  }

  function removeCurrent() {
    const item = candidates.current[reviewAt.current];
    if (busy.current || item === undefined || item.kept === null) {
      return;
    }
    const next = reviewAt.current + 1;
    reviewAt.current = next;
    syncHeld();
    captureService.discardPhoto(item.original);
    captureService.discardPhoto(item.kept);
    void enter(next);
  }

  function proceed() {
    if (checked.current.length === 0) {
      setPhase({ kind: "idle", notice: null, leftOut: leftOut.current });
    } else if (checked.current.some((page) => page.sharpness === "blurry")) {
      setPhase({ kind: "blurry" });
    } else {
      total.current = checked.current.length;
      void sendAll(checked.current.map((page) => ({ uri: page.uri, pageId: null })));
    }
  }

  async function sendAll(list: SeriesPage[]) {
    if (busy.current || !alive()) {
      return;
    }
    busy.current = true;
    const { notebookId, chapterId } = sentTo.current;
    const run = await sendSeries(list, {
      send: (page) => {
        const input = { notebookId, photoUri: page.uri, pageId: page.pageId, source: mode.current };
        inFlight.current = page.uri;
        return send
          .mutateAsync(chapterId === null ? input : { ...input, chapterId })
          .catch((): SendResult => ({ status: "failed", pageId: page.pageId }))
          .finally(() => {
            inFlight.current = null;
          });
      },
      discard: captureService.discardPhoto,
      onSettled: (page) => {
        held.current = held.current.filter((uri) => uri !== page.uri);
      },
      onProgress: (index) => {
        if (alive()) {
          setPhase({ kind: "sending", page: processed.current + index + 1, total: total.current });
        }
      },
      alive,
    });
    busy.current = false;
    if (!alive()) {
      run.pending.forEach((page) => captureService.discardPhoto(page.uri));
      return;
    }
    sentIds.current = [...sentIds.current, ...run.sent];
    leftOut.current += run.rejected;
    processed.current += run.sent.length + run.rejected;
    pending.current = run.pending;
    held.current = run.pending.map((page) => page.uri);
    setPages([]);
    if (run.stop === null) {
      finish();
    } else if (run.stop.status === "limit") {
      await stopForLimit(run.stop.reason, run.pending.length);
    } else {
      setPhase({ kind: "interrupted", pending: run.pending.length });
    }
  }

  function finish() {
    const next = destination(sentIds.current, sentTo.current.notebookId, sentTo.current.chapterId);
    if (leftOut.current === 0 && next !== null) {
      router.replace(next);
    } else if (next === null) {
      setPhase({ kind: "idle", notice: null, leftOut: leftOut.current });
    } else {
      setPhase({ kind: "ended", notSent: 0, block: null, leftOut: leftOut.current, next });
    }
  }

  async function stopForLimit(reason: BlockReason, notSent: number) {
    const fresh = await captureService.allowance().catch(() => null);
    if (!alive()) {
      return;
    }
    discardHeld();
    pending.current = [];
    const block = blockForReason(reason, fresh);
    const next = destination(sentIds.current, sentTo.current.notebookId, sentTo.current.chapterId);
    if (next === null) {
      router.replace({ pathname: "/limit", params: limitParams(block) });
    } else {
      setPhase({ kind: "ended", notSent, block, leftOut: leftOut.current, next });
    }
  }

  function leaveNow() {
    cancelled.current = true;
    discardHeld();
    if (mounted.current) {
      router.back();
    }
  }

  function lostCount(): number {
    if (candidates.current.length > 0 && replacing.current === null) {
      return accepted.current.length + candidates.current.length - reviewAt.current;
    }
    return held.current.length;
  }

  function leave() {
    const count = lostCount();
    if (count === 0) {
      router.back();
      return;
    }
    confirmDeletion(t.capture.leaveTitle, t.capture.leaveBody(count), { cancel: t.common.cancel, confirm: t.capture.leave }, leaveNow);
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (held.current.length === 0) {
        return false;
      }
      leave();
      return true;
    });
    return () => subscription.remove();
  });

  useEffect(() => {
    if (ready && !launched.current) {
      launched.current = true;
      void startScan(limit, null);
    }
  });

  return {
    phase,
    pages,
    scan: () => void startScan(limit, null),
    importPhotos: () => void startImport(limit, null),
    retake: (index: number) => void (mode.current === "import" ? startImport(1, index) : startScan(1, index)),
    rotate: () => void rotate(),
    keepImage: keepCurrent,
    removeImage: removeCurrent,
    sendAnyway: () => {
      total.current = checked.current.length;
      void sendAll(checked.current.map((page) => ({ uri: page.uri, pageId: null })));
    },
    retry: () => void sendAll(pending.current),
    leave,
    close: () => {
      const next = phase.kind === "ended" ? phase.next : null;
      if (next === null) {
        router.back();
      } else {
        router.replace(next);
      }
    },
  };
}
