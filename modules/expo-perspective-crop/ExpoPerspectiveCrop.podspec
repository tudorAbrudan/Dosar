require 'json'

Pod::Spec.new do |s|
  s.name           = 'ExpoPerspectiveCrop'
  s.version        = '1.0.0'
  s.summary        = 'Perspective correction + document corner detection (iOS)'
  s.description    = s.summary
  s.author         = { 'Dosar' => 'dosar@dosar.app' }
  s.license        = { :type => 'MIT' }
  s.homepage       = 'https://github.com/expo/expo'
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => 'https://github.com/expo/expo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "ios/*.swift"
  s.swift_version = '5.4'

  install_modules_dependencies(s)
end
