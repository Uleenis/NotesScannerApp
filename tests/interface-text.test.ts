import * as ts from "typescript";

import { findColorLiterals, findHardcodedText, type Finding } from "./source-literals";

const root = ts.sys.getCurrentDirectory();

function sourceFiles(): string[] {
  return ts.sys
    .readDirectory(`${root}/src`, [".ts", ".tsx"])
    .map((file) => file.slice(root.length + 1))
    .filter(
      (file) =>
        !file.startsWith("src/i18n/") &&
        file !== "src/theme.ts" &&
        !/\.test\.tsx?$/.test(file) &&
        !file.includes("__tests__/"),
    );
}

function report(find: (fileName: string, source: string) => Finding[]): string[] {
  return sourceFiles().flatMap((file) =>
    find(file, ts.sys.readFile(`${root}/${file}`) ?? "").map((finding) => `${file}:${finding.line} ${finding.text}`),
  );
}

test("the scan covers the screens", () => {
  expect(sourceFiles()).toEqual(expect.arrayContaining(["src/app/_layout.tsx", "src/app/index.tsx"]));
});

test("no interface text is written in the code", () => {
  expect(report(findHardcodedText)).toEqual([]);
});

test("no color is written outside the theme", () => {
  expect(report(findColorLiterals)).toEqual([]);
});
