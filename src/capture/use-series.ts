import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";

import { useStrings } from "@/i18n";
import { confirmDeletion } from "@/lib/action-menu";
import { blockForReason, type Block, type BlockReason } from "./allowance";
import { limitParams } from "./limit-route";
import { useSendPage } from "./queries";
import { scanPages, type ScanResult } from "./scanner";
import type { SendResult } from "./send-page";
import { captureService } from "./service";
import { destination, prepareScans, replaceAt, sendSeries, type CheckedPage, type SeriesPage } from "./series";

export type Target = { notebookId: string; chapterId: string | null };

export type Phase =
  | { kind: "idle"; notice: "unavailable" | "failed" | null; leftOut: number }
  | { kind: "scanning" }
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
        const input = { notebookId, photoUri: page.uri, pageId: page.pageId };
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

  function leave() {
    const count = held.current.length;
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
    retake: (index: number) => void startScan(1, index),
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
