export const MAX_PHOTO_PIXELS = 12_000_000;

export const PHOTO_QUALITY = 0.9;

export const SENSOR_TO_VIEWFINDER = 90;

const TAG_ANGLES: Record<number, number> = { 1: 0, 3: 180, 6: 90, 8: 270 };

export type Picture = { uri: string; width: number; height: number; exif?: unknown };

export type PhotoSize = { width: number; height: number };

export type PhotoTools = {
  save: (uri: string, degrees: number) => Promise<string>;
};

export function shrinkTarget(width: number, height: number): PhotoSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (width * height <= MAX_PHOTO_PIXELS) {
    return null;
  }
  const scale = Math.sqrt(MAX_PHOTO_PIXELS / (width * height));
  return { width: Math.floor(width * scale), height: Math.floor(height * scale) };
}

export function orientationTag(exif: unknown): unknown {
  if (typeof exif !== "object" || exif === null || !("Orientation" in exif)) {
    return undefined;
  }
  return exif.Orientation;
}

export function viewfinderTurn(tag: unknown, quarterTurns: number): number {
  const applied = TAG_ANGLES[Number(tag)] ?? 0;
  return (((SENSOR_TO_VIEWFINDER - applied + quarterTurns * 90) % 360) + 360) % 360;
}

export async function preparePhoto(picture: Picture, quarterTurns: number, tools: PhotoTools): Promise<string> {
  return tools.save(picture.uri, viewfinderTurn(orientationTag(picture.exif), quarterTurns));
}
