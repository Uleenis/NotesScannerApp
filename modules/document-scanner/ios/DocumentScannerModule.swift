import ExpoModulesCore
import UIKit
import VisionKit

private let pageLimitMax = 30
private let scansFolder = "scans"
private let jpegQuality: CGFloat = 0.92

public final class DocumentScannerModule: Module {
  private var session: ScanSession?

  public func definition() -> ModuleDefinition {
    Name("DocumentScanner")

    AsyncFunction("isAvailable") { () -> Bool in
      VNDocumentCameraViewController.isSupported
    }
    .runOnQueue(.main)

    AsyncFunction("scan") { (pageLimit: Int, galleryImport: Bool, promise: Promise) in
      guard pageLimit >= 1, pageLimit <= pageLimitMax else {
        promise.reject("ERR_SCAN_LIMIT", "Page limit out of range")
        return
      }
      guard self.session == nil else {
        promise.reject("ERR_SCAN_BUSY", "A scan is already open")
        return
      }
      guard VNDocumentCameraViewController.isSupported,
        let presenter = self.appContext?.utilities?.currentViewController()
      else {
        promise.reject("ERR_SCAN_START", "The scanner did not open")
        return
      }
      let controller = VNDocumentCameraViewController()
      let session = ScanSession(limit: pageLimit, promise: promise) { [weak self] in
        self?.session = nil
      }
      controller.delegate = session
      self.session = session
      presenter.present(controller, animated: true)
    }
    .runOnQueue(.main)
  }
}

private final class ScanSession: NSObject, VNDocumentCameraViewControllerDelegate {
  private let limit: Int
  private let promise: Promise
  private let done: () -> Void

  init(limit: Int, promise: Promise, done: @escaping () -> Void) {
    self.limit = limit
    self.promise = promise
    self.done = done
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    let images = (0..<min(scan.pageCount, limit)).map { scan.imageOfPage(at: $0) }
    controller.dismiss(animated: true)
    let promise = self.promise
    DispatchQueue.global(qos: .userInitiated).async {
      var kept: [URL] = []
      do {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(scansFolder, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for image in images {
          guard let data = image.jpegData(compressionQuality: jpegQuality) else {
            throw ScanKeepError()
          }
          let target = folder.appendingPathComponent("\(UUID().uuidString).jpg")
          kept.append(target)
          try data.write(to: target, options: .atomic)
        }
        promise.resolve(kept.map { $0.absoluteString })
      } catch {
        kept.forEach { try? FileManager.default.removeItem(at: $0) }
        promise.reject("ERR_SCAN_KEEP", "The pages could not be kept")
      }
    }
    done()
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true)
    promise.resolve([String]())
    done()
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    controller.dismiss(animated: true)
    promise.reject("ERR_SCAN_FAILED", "The scanner failed")
    done()
  }
}

private struct ScanKeepError: Error {}
