import * as ts from "typescript";

const kotlin =
  ts.sys.readFile(
    `${ts.sys.getCurrentDirectory()}/modules/document-scanner/android/src/main/java/expo/modules/documentscanner/DocumentScannerModule.kt`,
  ) ?? "";

describe("the Android scanner module", () => {
  it("opens ML Kit in its base mode only, with no filter and no cleaning", () => {
    expect(kotlin.match(/setScannerMode\(([^)]*)\)/g)).toEqual(["setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_BASE)"]);
    expect(kotlin).not.toMatch(/SCANNER_MODE_FULL|SCANNER_MODE_BASE_WITH_FILTER/);
  });

  it("opens the gallery only when asked", () => {
    expect(kotlin.match(/setGalleryImportAllowed\(([^)]*)\)/g)).toEqual(["setGalleryImportAllowed(galleryImport)"]);
  });

  it("asks for JPEG pages and the limit given", () => {
    expect(kotlin.match(/setResultFormats\(([^)]*)\)/g)).toEqual(["setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)"]);
    expect(kotlin.match(/setPageLimit\(([^)]*)\)/g)).toEqual(["setPageLimit(pageLimit)"]);
  });
});
