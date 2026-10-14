type EdgeRuntimeGlobal = { waitUntil: (promise: Promise<unknown>) => void };

export function runInBackground(task: Promise<void>): void {
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeGlobal }).EdgeRuntime;
  runtime?.waitUntil(task);
}
