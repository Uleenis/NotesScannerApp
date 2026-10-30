Pod::Spec.new do |s|
  s.name           = 'DocumentScanner'
  s.version        = '1.0.0'
  s.summary        = 'The system document scanner'
  s.description    = 'The system document scanner'
  s.license        = 'UNLICENSED'
  s.author         = 'NotesScannerApp'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.frameworks = 'VisionKit'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
