import Foundation

protocol NetworkQualityScheduledTask: AnyObject {
  func cancel()
}

extension DispatchWorkItem: NetworkQualityScheduledTask {}

final class Throttler {
  typealias Clock = () -> Double
  typealias Scheduler = (
    _ delayMs: Double,
    _ action: @escaping () -> Void
  ) -> NetworkQualityScheduledTask
  typealias Emitter = ([String: Any]) -> Void

  private static let numericKeys = [
    "downlinkKbps",
    "uplinkKbps",
    "signalStrength",
  ]

  private var throttleMs: Double
  private var bandwidthChangeThresholdPct: Double
  private let clock: Clock
  private let scheduler: Scheduler
  private let emit: Emitter

  private var lastEmitted: [String: Any]?
  private var lastEmitTime = -Double.infinity
  private var pending: [String: Any]?
  private var timer: NetworkQualityScheduledTask?

  init(
    throttleMs: Double,
    bandwidthChangeThresholdPct: Double,
    clock: @escaping Clock,
    scheduler: @escaping Scheduler,
    emit: @escaping Emitter
  ) {
    self.throttleMs = max(0, throttleMs)
    self.bandwidthChangeThresholdPct = max(0, bandwidthChangeThresholdPct)
    self.clock = clock
    self.scheduler = scheduler
    self.emit = emit
  }

  func update(throttleMs: Double, bandwidthChangeThresholdPct: Double) {
    self.throttleMs = max(0, throttleMs)
    self.bandwidthChangeThresholdPct = max(0, bandwidthChangeThresholdPct)
    guard let pending else { return }
    cancelPending()
    submit(pending)
  }

  func submit(_ snapshot: [String: Any]) {
    guard let previous = lastEmitted else {
      emitNow(snapshot)
      return
    }

    if Self.equalsIgnoringTimestamp(previous, snapshot) {
      cancelPending()
      return
    }

    if Self.isSignificantChange(previous, snapshot) {
      cancelPending()
      emitNow(snapshot)
      return
    }

    let changedNumericKeys = Self.numericKeys.filter {
      !Self.valuesEqual(previous[$0], snapshot[$0])
    }
    let crossesThreshold = changedNumericKeys.contains {
      Self.exceedsThreshold(
        oldValue: previous[$0],
        newValue: snapshot[$0],
        thresholdPct: bandwidthChangeThresholdPct
      )
    }
    guard crossesThreshold else {
      cancelPending()
      return
    }

    let now = clock()
    let elapsed = now - lastEmitTime
    if elapsed >= throttleMs {
      cancelPending()
      emitNow(snapshot)
      return
    }

    pending = snapshot
    guard timer == nil else { return }
    timer = scheduler(max(0, throttleMs - elapsed)) { [weak self] in
      guard let self else { return }
      self.timer = nil
      guard let pending = self.pending else { return }
      self.pending = nil
      self.emitNow(pending)
    }
  }

  func reset() {
    cancelPending()
    lastEmitted = nil
    lastEmitTime = -Double.infinity
  }

  static func equalsIgnoringTimestamp(
    _ first: [String: Any],
    _ second: [String: Any]
  ) -> Bool {
    PathSnapshot.comparableKeys.allSatisfy {
      valuesEqual(first[$0], second[$0])
    }
  }

  static func isSignificantChange(
    _ first: [String: Any],
    _ second: [String: Any]
  ) -> Bool {
    PathSnapshot.comparableKeys
      .filter { !numericKeys.contains($0) }
      .contains { !valuesEqual(first[$0], second[$0]) }
  }

  static func exceedsThreshold(
    oldValue: Any?,
    newValue: Any?,
    thresholdPct: Double
  ) -> Bool {
    let oldNumber = numericValue(oldValue)
    let newNumber = numericValue(newValue)
    if oldNumber == nil || newNumber == nil {
      return oldNumber != nil || newNumber != nil
    }
    guard let oldNumber, let newNumber else { return false }
    if oldNumber == newNumber { return false }
    if oldNumber == 0 { return true }
    return abs(newNumber - oldNumber) / abs(oldNumber) * 100 >= thresholdPct
  }

  private func emitNow(_ snapshot: [String: Any]) {
    lastEmitted = snapshot
    lastEmitTime = clock()
    emit(snapshot)
  }

  private func cancelPending() {
    timer?.cancel()
    timer = nil
    pending = nil
  }

  private static func numericValue(_ value: Any?) -> Double? {
    guard !(value is NSNull) else { return nil }
    return (value as? NSNumber)?.doubleValue
  }

  private static func valuesEqual(_ first: Any?, _ second: Any?) -> Bool {
    switch (first, second) {
    case (nil, nil):
      return true
    case let (first as NSObject, second as NSObject):
      return first.isEqual(second)
    default:
      return false
    }
  }
}
