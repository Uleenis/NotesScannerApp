export const MAX_PHOTO_PIXELS = 12_000_000;

export const PHOTO_QUALITY = 0.9;

export type Picture = { uri: string; width: number; height: number };

export type PhotoSize = { width: number; height: number };

export type PhotoTools = {
  shrink: (uri: string, size: PhotoSize) => Promise<string>;
  remove: (uri: string) => void;
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

export async function preparePhoto(picture: Picture, tools: PhotoTools): Promise<string> {
  const target = shrinkTarget(picture.width, picture.height);
  if (target === null) {
    return picture.uri;
  }
  let shrunk: string;
  try {
    shrunk = await tools.shrink(picture.uri, target);
  } catch {
    return picture.uri;
  }
  try {
    tools.remove(picture.uri);
  } catch {
    return shrunk;
  }
  return shrunk;
}
