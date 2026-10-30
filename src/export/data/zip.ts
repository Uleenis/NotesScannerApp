import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import { FileMode, type File } from "expo-file-system";

export const MAX_ARCHIVE_BYTES = 3_500_000_000;

const IDENTIFIER = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const ENTRY_NAME = new RegExp(
  `^(?:README\\.txt|export\\.json|profile\\.json|usage\\.json|notebooks\\.json|training\\.json|writing-tests/${IDENTIFIER}/[12]\\.jpg|pages/${IDENTIFIER}/(?:page\\.json|text\\.txt|original\\.jpg|prepared\\.jpg))$`,
);

const IDENTIFIER_ONLY = new RegExp(`^${IDENTIFIER}$`);

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_ONLY.test(value);
}

export class ArchiveTooLargeError extends Error {
  constructor() {
    super("The archive is too large.");
  }
}

export type ArchiveSink = {
  addText: (name: string, content: string) => void;
  addBinary: (name: string, chunks: Iterable<Uint8Array>) => void;
  written: () => number;
  finish: () => void;
  abort: () => void;
};

export function openZip(target: File, limit: number = MAX_ARCHIVE_BYTES): ArchiveSink {
  target.create();
  const handle = target.open(FileMode.Truncate);
  const names = new Set<string>();
  let written = 0;
  let failure: Error | null = null;
  let closed = false;

  function close(): void {
    if (!closed) {
      closed = true;
      handle.close();
    }
  }

  const zip = new Zip((error, chunk, final) => {
    if (failure !== null || closed) {
      return;
    }
    if (error !== null) {
      failure = error;
      return;
    }
    try {
      handle.writeBytes(chunk);
    } catch (thrown) {
      failure = thrown instanceof Error ? thrown : new Error("The archive could not be written.");
      return;
    }
    written += chunk.length;
    if (written > limit) {
      failure = new ArchiveTooLargeError();
    }
    if (final) {
      close();
    }
  });

  function check(): void {
    if (failure !== null) {
      throw failure;
    }
    if (closed) {
      throw new Error("The archive is closed.");
    }
  }

  function claim(name: string): void {
    check();
    if (!ENTRY_NAME.test(name)) {
      throw new Error("This name is not allowed in the archive.");
    }
    if (names.has(name)) {
      throw new Error("This name is already in the archive.");
    }
    names.add(name);
  }

  return {
    addText(name, content) {
      claim(name);
      const entry = new ZipDeflate(name, { level: 6 });
      zip.add(entry);
      entry.push(strToU8(content), true);
      check();
    },
    addBinary(name, chunks) {
      claim(name);
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      for (const chunk of chunks) {
        entry.push(chunk, false);
        check();
      }
      entry.push(new Uint8Array(0), true);
      check();
    },
    written: () => written,
    finish() {
      check();
      try {
        zip.end();
        if (failure !== null) {
          throw failure;
        }
      } finally {
        close();
      }
    },
    abort() {
      try {
        zip.terminate();
      } finally {
        close();
      }
    },
  };
}
