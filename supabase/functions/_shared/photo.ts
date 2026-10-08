export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export const PHOTO_MIME_TYPE = "image/jpeg";

export function photoPath(userId: string, pageId: string): string {
  return `${userId}/${pageId}/original.jpg`;
}

export function movedPhotoPath(path: string, fromId: string, toId: string): string {
  return `${toId}${path.slice(fromId.length)}`;
}

export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
