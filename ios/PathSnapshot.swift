import Foundation
import Network

enum PathSnapshot {
  static let comparableKeys = [
    "isConnected",
    "isValidated",
    "isCaptivePortal",
    "transport",
    "isVpn",
    "isExpensive",
    "isConstrained",
    "isRoaming",
    "downlinkKbps",
    "uplinkKbps",
    "signalStrength",
    "cellularGeneration",
    "supportsIPv4",
    "supportsIPv6",
    "supportsDNS",
    "unsatisfiedReason",
  ]

  static func make(path: NWPath, cellularInfo: CellularInfo) -> [String: Any] {
    let isConnected = path.status == .satisfied
    let transport = transport(path: path, isConnected: isConnected)
    let isCellular = transport == "cellular"

    return [
      "isConnected": isConnected,
      "isValidated": NSNull(),
      "isCaptivePortal": NSNull(),
      "transport": transport,
      "isVpn": NSNull(),
      "isExpensive": path.isExpensive,
      "isConstrained": path.isConstrained,
      "isRoaming": NSNull(),
      "downlinkKbps": NSNull(),
      "uplinkKbps": NSNull(),
      "signalStrength": NSNull(),
      "cellularGeneration": nullable(cellularInfo.generation(isCellular: isCellular)),
      "supportsIPv4": path.supportsIPv4,
      "supportsIPv6": path.supportsIPv6,
      "supportsDNS": path.supportsDNS,
      "unsatisfiedReason": nullable(unsatisfiedReason(path: path)),
      "timestamp": Date().timeIntervalSince1970 * 1_000,
    ]
  }

  static func unknownDisconnected() -> [String: Any] {
    [
      "isConnected": false,
      "isValidated": NSNull(),
      "isCaptivePortal": NSNull(),
      "transport": "unknown",
      "isVpn": NSNull(),
      "isExpensive": false,
      "isConstrained": false,
      "isRoaming": NSNull(),
      "downlinkKbps": NSNull(),
      "uplinkKbps": NSNull(),
      "signalStrength": NSNull(),
      "cellularGeneration": NSNull(),
      "supportsIPv4": NSNull(),
      "supportsIPv6": NSNull(),
      "supportsDNS": NSNull(),
      "unsatisfiedReason": "unknown",
      "timestamp": Date().timeIntervalSince1970 * 1_000,
    ]
  }

  private static func transport(path: NWPath, isConnected: Bool) -> String {
    guard isConnected else { return "none" }
    if path.usesInterfaceType(.wifi) { return "wifi" }
    if path.usesInterfaceType(.cellular) { return "cellular" }
    if path.usesInterfaceType(.wiredEthernet) { return "ethernet" }
    if path.usesInterfaceType(.other) || path.usesInterfaceType(.loopback) {
      return "other"
    }
    return "other"
  }

  private static func unsatisfiedReason(path: NWPath) -> String? {
    guard path.status != .satisfied else { return nil }

    if #available(iOS 17.0, *), path.unsatisfiedReason == .vpnInactive {
      return "vpnInactive"
    }

    switch path.unsatisfiedReason {
    case .notAvailable:
      return "notAvailable"
    case .cellularDenied:
      return "cellularDenied"
    case .wifiDenied:
      return "wifiDenied"
    case .localNetworkDenied:
      return "localNetworkDenied"
    case .vpnInactive:
      return "vpnInactive"
    @unknown default:
      return "unknown"
    }
  }

  private static func nullable(_ value: String?) -> Any {
    value ?? NSNull()
  }
}
