const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];

function excludes(indent) {
  return DOMAINS.map((domain) => `${indent}<exclude domain="${domain}" path="." />`).join("\n");
}

const EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludes("    ")}
  </cloud-backup>
  <device-transfer>
${excludes("    ")}
  </device-transfer>
</data-extraction-rules>
`;

const FULL_BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludes("  ")}
</full-backup-content>
`;

function applyNoBackup(manifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  application.$["android:allowBackup"] = "false";
  application.$["android:fullBackupContent"] = "@xml/no_backup_full";
  application.$["android:dataExtractionRules"] = "@xml/no_backup_extraction";
  return manifest;
}

function writeRules(projectRoot) {
  const folder = path.join(projectRoot, "app", "src", "main", "res", "xml");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "no_backup_extraction.xml"), EXTRACTION_RULES);
  fs.writeFileSync(path.join(folder, "no_backup_full.xml"), FULL_BACKUP_RULES);
}

function withNoBackup(config) {
  const withManifest = withAndroidManifest(config, (modConfig) => {
    applyNoBackup(modConfig.modResults);
    return modConfig;
  });
  return withDangerousMod(withManifest, [
    "android",
    async (modConfig) => {
      writeRules(modConfig.modRequest.platformProjectRoot);
      return modConfig;
    },
  ]);
}

module.exports = withNoBackup;
module.exports.applyNoBackup = applyNoBackup;
module.exports.EXTRACTION_RULES = EXTRACTION_RULES;
module.exports.FULL_BACKUP_RULES = FULL_BACKUP_RULES;
