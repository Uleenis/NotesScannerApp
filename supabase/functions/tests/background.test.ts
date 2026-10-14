import { assertEquals } from "jsr:@std/assert@1";
import { runInBackground } from "../_shared/background.ts";

type Holder = { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } };

Deno.test("background work is handed to EdgeRuntime.waitUntil, so it outlives the answer", () => {
  const holder = globalThis as Holder;
  const kept: Promise<unknown>[] = [];
  holder.EdgeRuntime = { waitUntil: (promise) => kept.push(promise) };
  try {
    const task = Promise.resolve();
    runInBackground(task);
    assertEquals(kept, [task]);
  } finally {
    delete holder.EdgeRuntime;
  }
});

Deno.test("without EdgeRuntime the work still runs and nothing throws", async () => {
  let ran = false;
  const task = Promise.resolve().then(() => {
    ran = true;
  });
  runInBackground(task);
  await task;
  assertEquals(ran, true);
});
