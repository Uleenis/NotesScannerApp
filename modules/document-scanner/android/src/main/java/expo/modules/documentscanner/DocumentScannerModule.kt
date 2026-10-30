package expo.modules.documentscanner

import android.app.Activity
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

private const val SCAN_REQUEST = 7301
private const val PAGE_LIMIT_MAX = 30
private const val SCANS_FOLDER = "scans"

class DocumentScannerModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("DocumentScanner")

    AsyncFunction("isAvailable") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    AsyncFunction("scan") { pageLimit: Int, galleryImport: Boolean, promise: Promise ->
      val activity = appContext.currentActivity
      when {
        pageLimit < 1 || pageLimit > PAGE_LIMIT_MAX -> promise.reject("ERR_SCAN_LIMIT", "Page limit out of range", null)
        pending != null -> promise.reject("ERR_SCAN_BUSY", "A scan is already open", null)
        activity == null -> promise.reject("ERR_SCAN_ACTIVITY", "No activity to open the scanner", null)
        else -> start(activity, pageLimit, galleryImport, promise)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != SCAN_REQUEST) {
        return@OnActivityResult
      }
      val promise = pending ?: return@OnActivityResult
      pending = null
      val result = if (payload.resultCode == Activity.RESULT_OK) GmsDocumentScanningResult.fromActivityResultIntent(payload.data) else null
      val pages = result?.pages?.map { it.imageUri } ?: emptyList()
      Thread { keep(pages, promise) }.start()
    }
  }

  private fun start(activity: Activity, pageLimit: Int, galleryImport: Boolean, promise: Promise) {
    val options = GmsDocumentScannerOptions.Builder()
      .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_BASE)
      .setGalleryImportAllowed(galleryImport)
      .setPageLimit(pageLimit)
      .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
      .build()
    pending = promise
    GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
      .addOnSuccessListener { sender ->
        try {
          activity.startIntentSenderForResult(sender, SCAN_REQUEST, null, 0, 0, 0)
        } catch (error: Exception) {
          failStart(error)
        }
      }
      .addOnFailureListener { error -> failStart(error) }
  }

  private fun failStart(error: Exception) {
    val promise = pending ?: return
    pending = null
    promise.reject("ERR_SCAN_START", "The scanner did not open", error)
  }

  private fun keep(pages: List<Uri>, promise: Promise) {
    val context = appContext.reactContext
    if (context == null) {
      promise.reject("ERR_SCAN_CONTEXT", "No context to keep the pages", null)
      return
    }
    val folder = File(context.cacheDir, SCANS_FOLDER)
    val kept = mutableListOf<File>()
    try {
      folder.mkdirs()
      for (page in pages) {
        val target = File(folder, "${UUID.randomUUID()}.jpg")
        kept.add(target)
        val input = context.contentResolver.openInputStream(page) ?: throw IllegalStateException("Page unreadable")
        input.use { source -> FileOutputStream(target).use { sink -> source.copyTo(sink) } }
      }
      promise.resolve(kept.map { Uri.fromFile(it).toString() })
    } catch (error: Exception) {
      kept.forEach { it.delete() }
      promise.reject("ERR_SCAN_KEEP", "The pages could not be kept", error)
    } finally {
      pages.forEach { eraseOwnCopy(it, context.cacheDir, context.filesDir) }
    }
  }

  private fun eraseOwnCopy(page: Uri, vararg roots: File) {
    val path = if (page.scheme == "file") page.path else null
    val file = path?.let { File(it).canonicalFile } ?: return
    if (roots.any { file.path.startsWith(it.canonicalPath + File.separator) }) {
      file.delete()
    }
  }
}
