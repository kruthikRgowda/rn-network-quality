import Foundation

final class NetworkProbe: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  struct Failure {
    let code: String
    let message: String
    let error: Error?
  }

  typealias Completion = (Result<[String: Any], Failure>) -> Void

  private enum Phase {
    case latency(index: Int)
    case download
    case finished
  }

  private static let maximumDownloadBytes = 5 * 1_024 * 1_024
  private static let minimumDownloadBytes = 32 * 1_024
  private static let minimumDownloadDurationMs = 50.0

  private let latencyURL: URL
  private let downloadURL: URL?
  private let latencySamples: Int
  private let timeoutMs: Double
  private let completion: Completion
  private let queue = DispatchQueue(label: "com.rnnetworkquality.probe")
  private let delegateQueue: OperationQueue

  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.waitsForConnectivity = false
    return URLSession(
      configuration: configuration,
      delegate: self,
      delegateQueue: delegateQueue
    )
  }()

  private var phase: Phase = .latency(index: 0)
  private var activeTask: URLSessionDataTask?
  private var requestStartedAt = 0.0
  private var responseHeadersAt: Double?
  private var metricRttByTask: [Int: Double] = [:]
  private var latencyResults: [Double] = []
  private var receivedBytes = 0
  private var reachedDownloadCap = false
  private var startedAt = 0.0
  private var timeoutItem: DispatchWorkItem?

  init(
    latencyURL: URL,
    downloadURL: URL?,
    latencySamples: Int,
    timeoutMs: Double,
    completion: @escaping Completion
  ) {
    self.latencyURL = latencyURL
    self.downloadURL = downloadURL
    self.latencySamples = max(1, latencySamples)
    self.timeoutMs = max(1, timeoutMs)
    self.completion = completion
    let delegateQueue = OperationQueue()
    delegateQueue.name = "com.rnnetworkquality.probe.delegate"
    delegateQueue.maxConcurrentOperationCount = 1
    delegateQueue.underlyingQueue = queue
    self.delegateQueue = delegateQueue
    super.init()
  }

  static func validatedURL(_ value: String) -> URL? {
    guard
      let components = URLComponents(string: value),
      let scheme = components.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      components.host?.isEmpty == false,
      let url = components.url
    else {
      return nil
    }
    return url
  }

  func start() {
    queue.async { [weak self] in
      guard let self else { return }
      startedAt = Self.monotonicMilliseconds()
      let timeout = DispatchWorkItem { [weak self] in
        self?.handleWholeProbeTimeout()
      }
      timeoutItem = timeout
      queue.asyncAfter(deadline: .now() + timeoutMs / 1_000, execute: timeout)
      startLatencyRequest(index: 0)
    }
  }

  func cancel() {
    queue.async { [weak self] in
      guard let self, !isFinished else { return }
      fail(
        code: "E_PROBE_FAILED",
        message: "The network probe was cancelled.",
        error: nil
      )
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    responseHeadersAt = Self.monotonicMilliseconds()
    completionHandler(.allow)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    guard case .download = phase else { return }
    let remaining = Self.maximumDownloadBytes - receivedBytes
    if remaining <= 0 {
      reachedDownloadCap = true
      dataTask.cancel()
      return
    }
    receivedBytes += min(remaining, data.count)
    if receivedBytes >= Self.maximumDownloadBytes {
      reachedDownloadCap = true
      dataTask.cancel()
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didFinishCollecting metrics: URLSessionTaskMetrics
  ) {
    guard
      let transaction = metrics.transactionMetrics.last,
      let requestStart = transaction.requestStartDate,
      let responseStart = transaction.responseStartDate
    else {
      return
    }
    metricRttByTask[task.taskIdentifier] =
      responseStart.timeIntervalSince(requestStart) * 1_000
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    guard !isFinished else { return }

    switch phase {
    case let .latency(index):
      if let error {
        let timedOut = (error as? URLError)?.code == .timedOut
        fail(
          code: timedOut ? "E_PROBE_TIMEOUT" : "E_PROBE_FAILED",
          message: timedOut
            ? "The latency phase exceeded the probe timeout."
            : "The latency request failed: \(error.localizedDescription)",
          error: error
        )
        return
      }

      if index > 0 {
        let fallbackRtt = max(
          0,
          (responseHeadersAt ?? Self.monotonicMilliseconds()) - requestStartedAt
        )
        latencyResults.append(metricRttByTask[task.taskIdentifier] ?? fallbackRtt)
      }

      if index < latencySamples {
        startLatencyRequest(index: index + 1)
      } else if downloadURL != nil {
        startDownloadRequest()
      } else {
        finish(downloadError: nil)
      }

    case .download:
      if let error, !reachedDownloadCap {
        finish(downloadError: error.localizedDescription)
      } else {
        finish(downloadError: nil)
      }
    case .finished:
      break
    }
  }

  private var isFinished: Bool {
    if case .finished = phase { return true }
    return false
  }

  private func startLatencyRequest(index: Int) {
    phase = .latency(index: index)
    startRequest(url: latencyURL)
  }

  private func startDownloadRequest() {
    guard let downloadURL else {
      finish(downloadError: nil)
      return
    }
    phase = .download
    receivedBytes = 0
    reachedDownloadCap = false
    startRequest(url: downloadURL)
  }

  private func startRequest(url: URL) {
    let remainingMs = timeoutMs - elapsedMilliseconds
    guard remainingMs > 0 else {
      handleWholeProbeTimeout()
      return
    }

    guard let requestURL = Self.cacheBustedURL(url) else {
      fail(
        code: "E_INVALID_URL",
        message: "Could not add a cache-busting query parameter to the probe URL.",
        error: nil
      )
      return
    }

    var request = URLRequest(url: requestURL)
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    request.timeoutInterval = max(0.001, remainingMs / 1_000)
    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

    requestStartedAt = Self.monotonicMilliseconds()
    responseHeadersAt = nil
    let task = session.dataTask(with: request)
    activeTask = task
    task.resume()
  }

  private func handleWholeProbeTimeout() {
    guard !isFinished else { return }
    switch phase {
    case .download:
      activeTask?.cancel()
      finish(downloadError: "The throughput phase exceeded the probe timeout.")
    case .latency:
      fail(
        code: "E_PROBE_TIMEOUT",
        message: "The latency phase exceeded the probe timeout.",
        error: nil
      )
    case .finished:
      break
    }
  }

  private func finish(downloadError: String?) {
    guard !isFinished else { return }
    let downloadDuration = max(
      0,
      Self.monotonicMilliseconds() - (responseHeadersAt ?? Self.monotonicMilliseconds())
    )
    let downlinkKbps: Double?
    if downloadURL != nil,
      receivedBytes >= Self.minimumDownloadBytes,
      downloadDuration >= Self.minimumDownloadDurationMs
    {
      downlinkKbps = Double(receivedBytes) * 8 / downloadDuration
    } else {
      downlinkKbps = nil
    }

    let result: [String: Any] = [
      "rttMs": Self.nullable(Self.median(latencyResults)),
      "downlinkKbps": Self.nullable(downlinkKbps),
      "bytesReceived": receivedBytes,
      "durationMs": elapsedMilliseconds,
      "downloadError": Self.nullable(downloadError),
      "timestamp": Date().timeIntervalSince1970 * 1_000,
    ]
    complete(.success(result))
  }

  private func fail(code: String, message: String, error: Error?) {
    complete(.failure(Failure(code: code, message: message, error: error)))
  }

  private func complete(_ result: Result<[String: Any], Failure>) {
    guard !isFinished else { return }
    phase = .finished
    timeoutItem?.cancel()
    activeTask?.cancel()
    session.invalidateAndCancel()
    completion(result)
  }

  private var elapsedMilliseconds: Double {
    Self.monotonicMilliseconds() - startedAt
  }

  private static func cacheBustedURL(_ url: URL) -> URL? {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return nil
    }
    var items = components.queryItems ?? []
    items.append(URLQueryItem(name: "_nq", value: UUID().uuidString))
    components.queryItems = items
    return components.url
  }

  private static func median(_ values: [Double]) -> Double? {
    guard !values.isEmpty else { return nil }
    let sorted = values.sorted()
    let middle = sorted.count / 2
    if sorted.count.isMultiple(of: 2) {
      return (sorted[middle - 1] + sorted[middle]) / 2
    }
    return sorted[middle]
  }

  private static func nullable(_ value: Any?) -> Any {
    value ?? NSNull()
  }

  private static func monotonicMilliseconds() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
  }
}

extension NetworkProbe.Failure: Error {}
