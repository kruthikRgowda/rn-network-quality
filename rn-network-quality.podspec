require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "rn-network-quality"
  s.module_name  = "rn_network_quality"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = {
    :git => "https://github.com/kruthikRgowda/rn-network-quality-.git",
    :tag => "v#{s.version}"
  }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  # The adapter header imports a C++ Codegen interface and must stay out of the
  # Swift module umbrella. The ObjC++ implementation includes it directly.
  s.private_header_files = "ios/NetworkQuality.h"
  s.frameworks = "Network", "CoreTelephony"
  s.swift_version = "5.9"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }
  s.resource_bundles = {
    "RNNetworkQualityPrivacy" => ["ios/PrivacyInfo.xcprivacy"]
  }

  install_modules_dependencies(s)
end
