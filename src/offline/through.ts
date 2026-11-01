import { beginMirror, type Mirror } from "./mirror";

export async function throughMirror<T>(request: () => Promise<T>, write: (mirror: Mirror, result: T) => Promise<void>): Promise<T> {
  const mirror = beginMirror();
  const result = await request();
  try {
    await write(mirror, result);
  } catch {
    return result;
  }
  return result;
}
