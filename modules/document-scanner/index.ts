import { requireOptionalNativeModule } from "expo";

export type NativeDocumentScanner = {
  isAvailable(): Promise<unknown>;
  scan(pageLimit: number, galleryImport: boolean): Promise<unknown>;
};

export function documentScanner(): NativeDocumentScanner | null {
  return requireOptionalNativeModule<NativeDocumentScanner>("DocumentScanner");
}
