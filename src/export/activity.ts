import type { ExportControl } from "./run";

let current: ExportControl | null = null;
const listeners = new Set<() => void>();

function publish(next: ExportControl | null): void {
  current = next;
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

export function beginExport(): ExportControl | null {
  if (current !== null) {
    return null;
  }
  const control: ExportControl = { cancelled: false };
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
  if (current === control) {
    publish(null);
  }
}
