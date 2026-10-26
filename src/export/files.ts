import { Directory, File, Paths } from "expo-file-system";
import { printToFileAsync } from "expo-print";
import { isAvailableAsync, shareAsync } from "expo-sharing";

export type ExportFormat = "pdf" | "markdown";

export type ExportFile = { format: ExportFormat; name: string; content: string };

export type SavedExport = { uri: string; discard: () => void };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_MARGIN = 40;

const KINDS: Record<ExportFormat, { extension: string; mimeType: string; uti: string }> = {
  pdf: { extension: "pdf", mimeType: "application/pdf", uti: "com.adobe.pdf" },
  markdown: { extension: "md", mimeType: "text/markdown", uti: "net.daringfireball.markdown" },
};

export function freshFolder(prefix: string = "export"): Directory {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const folder = new Directory(Paths.cache, `${prefix}-${suffix}`);
  folder.create();
  return folder;
}

export function quietly(action: () => void): void {
  try {
    action();
  } catch {
    return;
  }
}

export function sweepExports(): void {
  quietly(() => {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof Directory && entry.name.startsWith("export-")) {
        quietly(() => entry.delete());
      }
    }
  });
}

export function discarding(folder: Directory): () => void {
  return () => quietly(() => folder.delete());
}

function print(content: string) {
  return printToFileAsync({
    html: content,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    margins: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
    base64: true,
  });
}

function stepFailure(name: "PrintFailed" | "WriteFailed", cause: unknown): Error {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code: unknown }).code : undefined;
  return Object.assign(new Error(name), { name, code: typeof code === "string" ? code : undefined });
}

async function printPdf(content: string, target: File): Promise<void> {
  const printed = await print(content)
    .catch(() => print(content))
    .catch((error: unknown) => {
      throw stepFailure("PrintFailed", error);
    });
  quietly(() => new File(printed.uri).delete());
  const data = printed.base64;
  if (typeof data !== "string" || data === "") {
    throw stepFailure("PrintFailed", null);
  }
  try {
    target.write(data, { encoding: "base64" });
  } catch (error) {
    throw stepFailure("WriteFailed", error);
  }
}

export async function saveExport(file: ExportFile): Promise<SavedExport> {
  sweepExports();
  const folder = freshFolder();
  const discard = discarding(folder);
  const target = new File(folder, `${file.name}.${KINDS[file.format].extension}`);
  try {
    if (file.format === "pdf") {
      await printPdf(file.content, target);
    } else {
      target.write(file.content);
    }
  } catch (error) {
    discard();
    throw error;
  }
  return { uri: target.uri, discard };
}

export async function shareExport(uri: string, format: ExportFormat): Promise<boolean> {
  if (!(await isAvailableAsync())) {
    return false;
  }
  const kind = KINDS[format];
  await shareAsync(uri, { mimeType: kind.mimeType, UTI: kind.uti });
  return true;
}
