import { archiveFileName, archiveReadme } from "@/export/data/readme";
import { strings } from "@/i18n";

const FILES = ["README.txt", "export.json", "profile.json", "usage.json", "notebooks.json", "training.json", "writing-tests/<id>/1.jpg", "pages/<id>/page.json", "pages/<id>/text.txt", "original.jpg", "prepared.jpg"];

describe("archiveReadme", () => {
  test("describes every file of the archive in English then in French", () => {
    const readme = archiveReadme();
    const middle = readme.indexOf(strings.fr.myData.readme[0]);

    expect(readme.startsWith(strings.en.myData.readme[0])).toBe(true);
    expect(middle).toBeGreaterThan(0);
    for (const file of FILES) {
      expect(readme.slice(0, middle)).toContain(file);
      expect(readme.slice(middle)).toContain(file);
    }
  });

  test("keeps one line per file in the lists", () => {
    const lines = archiveReadme().split("\n").filter((line) => line.startsWith("- "));

    expect(lines).toHaveLength(20);
  });
});

describe("archiveFileName", () => {
  test("adds the date of the export", () => {
    expect(archiveFileName("notes-data", new Date("2026-10-24T23:30:00Z"))).toBe("notes-data-2026-10-24");
  });
});
