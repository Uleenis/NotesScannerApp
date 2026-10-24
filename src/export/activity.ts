import type { ExportControl } from "./run";

export type ExportProgress = { done: number; total: number };

let current: ExportControl | null = null;
let active: ExportControl | null = null;
let progress: ExportProgress | null = null;
const listeners = new Set<() => void>();

function publish(next: ExportControl | null): void {
  current = next;
  if (next === null) {
    progress = null;
  }
  listeners.forEach((listener) => listener());
}

export function subscribeToExport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentExport(): ExportControl | null {
  return current;
}

export function currentProgress(): ExportProgress | null {
  return progress;
}

export function reportProgress(control: ExportControl, done: number, total: number): void {
  if (current !== control) {
    return;
  }
  progress = { done, total };
  listeners.forEach((listener) => listener());
}

export function beginExport(): ExportControl | null {
  if (active !== null) {
    return null;
  }
  const control: ExportControl = { cancelled: false };
  active = control;
  progress = null;
  publish(control);
  return control;
}

export function cancelExport(): void {
  if (current !== null) {
    current.cancelled = true;
    publish(null);
  }
}

export function endExport(control: ExportControl): void {
  if (active === control) {
    active = null;
  }
  if (current === control) {
    publish(null);
  }
}
