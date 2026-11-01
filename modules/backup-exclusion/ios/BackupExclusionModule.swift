import ExpoModulesCore
import Foundation

public class BackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackupExclusion")

    Function("exclude") { (uri: String) -> Bool in
      guard var url = URL(string: uri), url.isFileURL else {
        return false
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      do {
        try url.setResourceValues(values)
        let read = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
        return read.isExcludedFromBackup == true
      } catch {
        return false
      }
    }
  }
}
