import Foundation
import Network

@objc(NetworkQualityImpl)
public final class NetworkQualityImpl: NSObject {
  @objc public var onChange: (([String: Any]) -> Void)?

  private let queue = DispatchQueue(label: "com.rnnetworkquality.monitor")
  private let queueKey = DispatchSpecificKey<UInt8>()
  private let cellularInfo = CellularInfo()
  private var monitor: NWPathMonitor?
  private var throttler: Throttler?
  private var latestSnapshot: [String: Any]?
  private var activeProbes: [UUID: NetworkProbe] = [:]
  private var activeOneShots: [UUID: OneShotRequest] = [:]
  private var invalidated = false

  public override init() {
    super.init()
    queue.setSpecific(key: queueKey, value: 1)
  }

  @objc(getCurrentStateWithResolve:reject:)
  public func getCurrentState(
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    queue.async { [weak self] in
      guard let self else { return }
      guard !invalidated else {
        reject("E_PROBE_FAILED", "NetworkQuality has been invalidated.", nil)
        return
      }
      if let monitor {
        let snapshot = latestSnapshot
          ?? PathSnapshot.make(path: monitor.currentPath, cellularInfo: cellularInfo)
        latestSnapshot = snapshot
        resolve(snapshot)
        return
      }

      withOneShotPath { [weak self] path, _ in
        guard let self else { return }
        if let path {
          resolve(PathSnapshot.make(path: path, cellularInfo: cellularInfo))
        } else {
          resolve(PathSnapshot.unknownDisconnected())
        }
      }
    }
  }

  @objc(startMonitoringWithThrottleMs:bandwidthChangeThresholdPct:)
  public func startMonitoring(
    throttleMs: NSNumber,
    bandwidthChangeThresholdPct: NSNumber
  ) {
    queue.async { [weak self] in
      guard let self else { return }
      guard !invalidated else { return }
      let throttle = max(0, throttleMs.doubleValue)
      let threshold = max(0, bandwidthChangeThresholdPct.doubleValue)

      if let throttler {
        throttler.update(
          throttleMs: throttle,
          bandwidthChangeThresholdPct: threshold
        )
      } else {
        throttler = makeThrottler(
          throttleMs: throttle,
          bandwidthChangeThresholdPct: threshold
        )
      }

      guard monitor == nil else { return }
      let pathMonitor = NWPathMonitor()
      monitor = pathMonitor
      pathMonitor.pathUpdateHandler = { [weak self] path in
        self?.handle(path: path)
      }
      pathMonitor.start(queue: queue)
      handle(path: pathMonitor.currentPath)
    }
  }

  @objc public func stopMonitoring() {
    queue.async { [weak self] in
      self?.stopMonitoringOnQueue()
    }
  }

  @objc(probeWithLatencyUrl:downloadUrl:latencySamples:timeoutMs:resolve:reject:)
  public func probe(
    latencyUrl: String,
    downloadUrl: String?,
    latencySamples: NSNumber,
    timeoutMs: NSNumber,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    guard let latencyURL = NetworkProbe.validatedURL(latencyUrl) else {
      reject("E_INVALID_URL", "latencyUrl must be a valid HTTP or HTTPS URL.", nil)
      return
    }

    let downloadURL: URL?
    if let downloadUrl {
      guard let validated = NetworkProbe.validatedURL(downloadUrl) else {
        reject("E_INVALID_URL", "downloadUrl must be a valid HTTP or HTTPS URL.", nil)
        return
      }
      downloadURL = validated
    } else {
      downloadURL = nil
    }

    let latencySampleValue = latencySamples.doubleValue
    guard
      latencySampleValue.isFinite,
      latencySampleValue.rounded(.towardZero) == latencySampleValue,
      latencySampleValue >= 1,
      latencySampleValue <= 100
    else {
      reject(
        "E_PROBE_FAILED",
        "latencySamples must be an integer between 1 and 100.",
        nil
      )
      return
    }
    let timeoutValue = timeoutMs.doubleValue
    guard timeoutValue.isFinite, timeoutValue > 0, timeoutValue <= 2_147_483_647
    else {
      reject(
        "E_PROBE_FAILED",
        "timeoutMs must be greater than 0 and at most 2147483647.",
        nil
      )
      return
    }

    queue.async { [weak self] in
      guard let self else { return }
      guard !invalidated else {
        reject("E_PROBE_FAILED", "NetworkQuality has been invalidated.", nil)
        return
      }
      currentPath { [weak self] path, wasCancelled in
        guard let self else { return }
        guard !invalidated else {
          reject("E_PROBE_FAILED", "NetworkQuality has been invalidated.", nil)
          return
        }
        guard !wasCancelled else {
          reject("E_PROBE_FAILED", "The network probe was cancelled.", nil)
          return
        }
        guard let path, path.status == .satisfied else {
          reject("E_OFFLINE", "No connected network is available for probing.", nil)
          return
        }

        let identifier = UUID()
        let networkProbe = NetworkProbe(
          latencyURL: latencyURL,
          downloadURL: downloadURL,
          latencySamples: Int(latencySampleValue),
          timeoutMs: max(1, timeoutValue)
        ) { [weak self] result in
          self?.queue.async {
            self?.activeProbes.removeValue(forKey: identifier)
          }
          switch result {
          case let .success(value):
            resolve(value)
          case let .failure(failure):
            reject(failure.code, failure.message, failure.error)
          }
        }
        activeProbes[identifier] = networkProbe
        networkProbe.start()
      }
    }
  }

  @objc public func invalidate() {
    performSynchronouslyOnQueue { [weak self] in
      guard let self else { return }
      guard !invalidated else { return }
      invalidated = true
      stopMonitoringOnQueue()
      onChange = nil
    }
  }

  private func makeThrottler(
    throttleMs: Double,
    bandwidthChangeThresholdPct: Double
  ) -> Throttler {
    Throttler(
      throttleMs: throttleMs,
      bandwidthChangeThresholdPct: bandwidthChangeThresholdPct,
      clock: {
        Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
      },
      scheduler: { [weak self] delayMs, action in
        let item = DispatchWorkItem(block: action)
        self?.queue.asyncAfter(deadline: .now() + delayMs / 1_000, execute: item)
        return item
      },
      emit: { [weak self] snapshot in
        self?.onChange?(snapshot)
      }
    )
  }

  private func handle(path: NWPath) {
    let snapshot = PathSnapshot.make(path: path, cellularInfo: cellularInfo)
    latestSnapshot = snapshot
    throttler?.submit(snapshot)
  }

  private func stopMonitoringOnQueue() {
    monitor?.pathUpdateHandler = nil
    monitor?.cancel()
    monitor = nil
    latestSnapshot = nil
    throttler?.reset()
    throttler = nil
    activeProbes.values.forEach { $0.cancel() }
    activeProbes.removeAll()
    Array(activeOneShots.keys).forEach {
      finishOneShot($0, path: nil, wasCancelled: true)
    }
  }

  private func currentPath(
    completion: @escaping (NWPath?, Bool) -> Void
  ) {
    if let monitor {
      completion(monitor.currentPath, false)
    } else {
      withOneShotPath(completion: completion)
    }
  }

  private func withOneShotPath(
    completion: @escaping (NWPath?, Bool) -> Void
  ) {
    let oneShot = NWPathMonitor()
    let identifier = UUID()
    activeOneShots[identifier] = OneShotRequest(
      monitor: oneShot,
      completion: completion
    )

    oneShot.pathUpdateHandler = { [weak self] path in
      self?.finishOneShot(identifier, path: path, wasCancelled: false)
    }
    oneShot.start(queue: queue)

    queue.asyncAfter(deadline: .now() + 2) { [weak self] in
      self?.finishOneShot(identifier, path: nil, wasCancelled: false)
    }
  }

  private func finishOneShot(
    _ identifier: UUID,
    path: NWPath?,
    wasCancelled: Bool
  ) {
    guard let request = activeOneShots.removeValue(forKey: identifier) else {
      return
    }
    request.monitor.pathUpdateHandler = nil
    request.monitor.cancel()
    request.completion(path, wasCancelled)
  }

  private func performSynchronouslyOnQueue(_ action: () -> Void) {
    if DispatchQueue.getSpecific(key: queueKey) != nil {
      action()
    } else {
      queue.sync(execute: action)
    }
  }
}

private struct OneShotRequest {
  let monitor: NWPathMonitor
  let completion: (NWPath?, Bool) -> Void
}
