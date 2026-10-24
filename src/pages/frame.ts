export type PhotoSize = { width: number; height: number };

export type Frame = { left: number; top: number; width: number; height: number };

const EDGE_TOLERANCE = 2;

export function frameOf(box: readonly number[], photo: PhotoSize): Frame | null {
  if (box.length !== 4 || !box.every(Number.isFinite) || !(photo.width > 0) || !(photo.height > 0)) {
    return null;
  }
  const [x1, y1, x2, y2] = box;
  if (x1 >= x2 || y1 >= y2) {
    return null;
  }
  if (x1 < 0 || y1 < 0 || x1 >= photo.width || y1 >= photo.height || x2 > photo.width + EDGE_TOLERANCE || y2 > photo.height + EDGE_TOLERANCE) {
    return null;
  }
  const right = Math.min(x2, photo.width);
  const bottom = Math.min(y2, photo.height);
  return {
    left: x1 / photo.width,
    top: y1 / photo.height,
    width: (right - x1) / photo.width,
    height: (bottom - y1) / photo.height,
  };
}
