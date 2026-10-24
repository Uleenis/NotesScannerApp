const POSITION = /^\d{1,9}$/;

export function parseFound(value: string | string[] | undefined): number | null {
  return typeof value === "string" && POSITION.test(value) ? Number(value) : null;
}
