require 'json'

Pod::Spec.new do |s|
  s.name           = 'ExpoCloudKitShare'
  s.version        = '1.0.0'
  s.summary        = 'CloudKit zone sharing (CKShare) between iCloud accounts (iOS)'
  s.description    = s.summary
  s.author         = { 'Dosar' => 'dosar@dosar.app' }
  s.license        = { :type => 'MIT' }
  s.homepage       = 'https://github.com/expo/expo'
  # Spike-ul folosește API-uri CloudKit disponibile iOS 15+. Bump la 17.0
  # (app-wide) vine în Faza 2 odată cu CKSyncEngine.
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => 'https://github.com/expo/expo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CloudKit', 'UIKit'

  s.source_files = "ios/*.swift"
  s.swift_version = '5.4'

  install_modules_dependencies(s)
end
