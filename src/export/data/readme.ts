import { strings } from "@/i18n";

export function archiveReadme(): string {
  return `${strings.en.myData.readme.join("\n\n")}\n\n\n${strings.fr.myData.readme.join("\n\n")}\n`;
}

export function archiveFileName(base: string, now: Date): string {
  return `${base}-${now.toISOString().slice(0, 10)}`;
}
