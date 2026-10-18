type NavigatorLike = { appVersion?: unknown; userAgent?: unknown };

const found = (globalThis as { navigator?: NavigatorLike }).navigator;

if (found !== undefined && found !== null) {
  if (typeof found.appVersion !== "string") {
    found.appVersion = "";
  }
  if (typeof found.userAgent !== "string") {
    found.userAgent = "";
  }
}

export {};
