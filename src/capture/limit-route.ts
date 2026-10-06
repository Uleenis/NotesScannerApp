import type { Block } from "./allowance";

export type LimitParams = { kind: Block["kind"]; max?: string; month?: string };

export function limitParams(block: Block): LimitParams {
  if (block.kind !== "month") {
    return { kind: block.kind };
  }
  return block.resetMonth === null ? { kind: "month", max: String(block.max) } : { kind: "month", max: String(block.max), month: String(block.resetMonth) };
}

export function readLimitParams(params: Partial<Record<keyof LimitParams, string | string[]>>): Block | null {
  const { kind, max, month } = params;
  if (kind === "trial" || kind === "daily") {
    return { kind };
  }
  if (kind !== "month" || typeof max !== "string") {
    return null;
  }
  const pages = Number(max);
  const resetMonth = typeof month === "string" ? Number(month) : null;
  if (!Number.isInteger(pages) || (resetMonth !== null && !Number.isInteger(resetMonth))) {
    return null;
  }
  return { kind: "month", max: pages, resetMonth };
}
