import { looksLikeNetworkFailure } from "@/capture/api";
import { checkedUuid } from "./bytes";
import { isJpeg } from "./page-photos";
import { PHOTO_BYTES_MAX } from "./photos";

export const FETCH_TIMEOUT_MS = 45_000;

export type PhotoFetch = { status: "ok"; bytes: Uint8Array } | { status: "gone" } | { status: "network" };

export type FetchPhotoDeps = {
  signedUrl: (path: string) => Promise<string>;
  fetch: typeof fetch;
};

export async function fetchPhotoAt(fetchPhoto: typeof fetch, url: string): Promise<PhotoFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchPhoto(url, { signal: controller.signal });
    if (response.status === 404 || response.status === 400 || response.status === 403) {
      return { status: "gone" };
    }
    if (!response.ok) {
      return { status: "network" };
    }
    const announced = Number(response.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > PHOTO_BYTES_MAX) {
      return { status: "gone" };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PHOTO_BYTES_MAX || !isJpeg(bytes)) {
      return { status: "gone" };
    }
    return { status: "ok", bytes };
  } catch {
    return { status: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPagePhoto(deps: FetchPhotoDeps, userId: string, pageId: string): Promise<PhotoFetch> {
  const path = `${checkedUuid(userId)}/${checkedUuid(pageId)}/original.jpg`;
  let url: string;
  try {
    url = await deps.signedUrl(path);
  } catch (error) {
    return { status: looksLikeNetworkFailure(error) ? "network" : "gone" };
  }
  return fetchPhotoAt(deps.fetch, url);
}
