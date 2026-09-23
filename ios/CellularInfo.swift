import CoreTelephony
import Foundation

final class CellularInfo {
  private let networkInfo = CTTelephonyNetworkInfo()

  func generation(isCellular: Bool) -> String? {
    guard isCellular else { return nil }

    let technology: String?
    if #available(iOS 12.0, *) {
      guard let serviceIdentifier = networkInfo.dataServiceIdentifier else {
        return nil
      }
      technology = networkInfo.serviceCurrentRadioAccessTechnology?[serviceIdentifier]
    } else {
      technology = networkInfo.currentRadioAccessTechnology
    }

    guard let technology else { return nil }
    return Self.map(technology)
  }

  private static func map(_ technology: String) -> String? {
    switch technology {
    case CTRadioAccessTechnologyGPRS,
      CTRadioAccessTechnologyEdge,
      CTRadioAccessTechnologyCDMA1x:
      return "2g"
    case CTRadioAccessTechnologyWCDMA,
      CTRadioAccessTechnologyHSDPA,
      CTRadioAccessTechnologyHSUPA,
      CTRadioAccessTechnologyCDMAEVDORev0,
      CTRadioAccessTechnologyCDMAEVDORevA,
      CTRadioAccessTechnologyCDMAEVDORevB,
      CTRadioAccessTechnologyeHRPD:
      return "3g"
    case CTRadioAccessTechnologyLTE:
      return "4g"
    case CTRadioAccessTechnologyNR,
      CTRadioAccessTechnologyNRNSA:
      return "5g"
    default:
      return nil
    }
  }
}
