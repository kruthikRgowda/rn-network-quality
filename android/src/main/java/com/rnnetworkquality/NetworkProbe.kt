package com.rnnetworkquality

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import java.io.IOException
import java.net.CookieHandler
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.ceil

/** Runs each explicit probe on its own executor bound to the current Android network. */
internal class NetworkProbe(context: Context) {
  private val connectivityManager =
    context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val operations = ConcurrentHashMap.newKeySet<ProbeOperation>()

  @Volatile
  private var invalidated = false

  fun probe(options: ReadableMap, promise: Promise) {
    val parsed = try {
      parseOptions(options)
    } catch (error: InvalidUrlException) {
      promise.reject(ERROR_INVALID_URL, error.message, error)
      return
    } catch (error: IllegalArgumentException) {
      promise.reject(ERROR_PROBE_FAILED, error.message, error)
      return
    }

    if (invalidated) {
      promise.reject(ERROR_PROBE_FAILED, "The network probe is unavailable")
      return
    }

    val executor = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "RNNetworkQualityProbe").apply { isDaemon = true }
    }
    val timeoutExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
      Thread(runnable, "RNNetworkQualityProbeTimeout").apply { isDaemon = true }
    }
    val operation = ProbeOperation(executor, timeoutExecutor, promise)
    synchronized(operations) {
      operations += operation
    }
    try {
      executor.execute {
        try {
          runProbe(parsed, operation)
        } finally {
          operation.finish()
          synchronized(operations) {
            operations -= operation
          }
        }
      }
    } catch (error: RejectedExecutionException) {
      synchronized(operations) {
        operations -= operation
      }
      operation.cancel("The network probe executor is unavailable", error)
    }
  }

  fun invalidate() {
    invalidated = true
    cancelActive()
  }

  fun cancelActive() {
    val active = synchronized(operations) {
      operations.toList().also { operations.clear() }
    }
    active.forEach { it.cancel("The network probe was cancelled") }
  }

  private fun runProbe(options: ProbeOptions, operation: ProbeOperation) {
    if (operation.isCancelled || invalidated) {
      operation.reject(ERROR_PROBE_FAILED, "The network probe was cancelled")
      return
    }

    val startedNanos = SystemClock.elapsedRealtimeNanos()
    val deadlineNanos = startedNanos + options.timeoutMs * NANOS_PER_MILLISECOND
    try {
      operation.armTimeout(options.timeoutMs)
    } catch (error: RejectedExecutionException) {
      operation.reject(ERROR_PROBE_FAILED, "The network probe was cancelled", error)
      return
    }

    val network = activeConnectedNetwork()
    if (operation.hasTimedOut) {
      operation.reject(
        ERROR_PROBE_TIMEOUT,
        "The network probe exceeded its ${options.timeoutMs} ms timeout",
      )
      return
    }
    if (network == null) {
      operation.reject(ERROR_OFFLINE, "A connected default network is required to run a probe")
      return
    }

    try {
      ensureCookieIsolation()
    } catch (error: CookieIsolationException) {
      operation.reject(ERROR_PROBE_FAILED, error.message, error)
      return
    }
    if (operation.hasTimedOut) {
      operation.reject(
        ERROR_PROBE_TIMEOUT,
        "The network probe exceeded its ${options.timeoutMs} ms timeout",
      )
      return
    }

    val rttMs = try {
      measureLatency(network, options, deadlineNanos, operation)
    } catch (error: Exception) {
      val timedOut = isTimeout(error, deadlineNanos, operation)
      val code = if (timedOut) ERROR_PROBE_TIMEOUT else ERROR_PROBE_FAILED
      val message = if (timedOut) {
        "The network probe exceeded its ${options.timeoutMs} ms timeout"
      } else {
        "The latency probe failed: ${messageFor(error)}"
      }
      operation.reject(code, message, error)
      return
    }

    var bytesReceived = 0L
    var downlinkKbps: Double? = null
    var downloadError: String? = null
    if (options.downloadUrl != null) {
      try {
        val download = measureThroughput(
          network,
          options,
          deadlineNanos,
          operation,
        ) { received ->
          bytesReceived = received
        }
        bytesReceived = download.bytesReceived
        downlinkKbps = download.downlinkKbps
        downloadError = download.downloadError
      } catch (error: Exception) {
        downloadError = if (isTimeout(error, deadlineNanos, operation)) {
          "Download phase timed out"
        } else {
          "Download phase failed: ${messageFor(error)}"
        }
      }
    }

    if (operation.hasTimedOut || SystemClock.elapsedRealtimeNanos() >= deadlineNanos) {
      if (options.downloadUrl == null) {
        operation.reject(
          ERROR_PROBE_TIMEOUT,
          "The network probe exceeded its ${options.timeoutMs} ms timeout",
        )
        return
      }
      downlinkKbps = null
      downloadError = "Download phase timed out"
    }
    if (operation.isCancelled || invalidated) {
      operation.reject(ERROR_PROBE_FAILED, "The network probe was cancelled")
      return
    }

    val durationMs = nanosToMilliseconds(SystemClock.elapsedRealtimeNanos() - startedNanos)
    operation.resolve(
      Arguments.createMap().apply {
        putDouble("rttMs", rttMs)
        if (downlinkKbps == null) putNull("downlinkKbps") else {
          putDouble("downlinkKbps", downlinkKbps)
        }
        putDouble("bytesReceived", bytesReceived.toDouble())
        putDouble("durationMs", durationMs)
        if (downloadError == null) putNull("downloadError") else {
          putString("downloadError", downloadError)
        }
        putDouble("timestamp", System.currentTimeMillis().toDouble())
      }
    )
  }

  private fun activeConnectedNetwork(): Network? = try {
    val network = connectivityManager.activeNetwork ?: return null
    val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return null
    network.takeIf {
      capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
  } catch (_: RuntimeException) {
    null
  }

  private fun measureLatency(
    network: Network,
    options: ProbeOptions,
    deadlineNanos: Long,
    operation: ProbeOperation,
  ): Double {
    val samples = mutableListOf<Double>()
    for (index in 0..options.latencySamples) {
      ensureWithinDeadline(deadlineNanos, operation)
      val connection = openConnection(network, options.latencyUrl, deadlineNanos, operation)
      var completedSuccessfully = false
      try {
        val timing = receiveResponseHeaders(connection, deadlineNanos, operation)
        if (index > 0) {
          samples += nanosToMilliseconds(timing.receivedNanos - timing.startedNanos)
        }
        readResponseFully(connection, deadlineNanos, operation)
        completedSuccessfully = true
      } finally {
        operation.clearConnection(connection)
        // Fully consuming and closing a successful response returns its socket to
        // HttpURLConnection's pool, allowing retained samples to reuse DNS/TCP/TLS.
        // Failed or cancelled requests cannot be safely pooled.
        if (!completedSuccessfully) connection.disconnect()
      }
    }

    samples.sort()
    ensureWithinDeadline(deadlineNanos, operation)
    val middle = samples.size / 2
    return if (samples.size % 2 == 1) {
      samples[middle]
    } else {
      (samples[middle - 1] + samples[middle]) / 2.0
    }
  }

  private fun measureThroughput(
    network: Network,
    options: ProbeOptions,
    deadlineNanos: Long,
    operation: ProbeOperation,
    onBytesReceived: (Long) -> Unit,
  ): DownloadMeasurement {
    ensureWithinDeadline(deadlineNanos, operation)
    val downloadUrl = requireNotNull(options.downloadUrl)
    val connection = openConnection(network, downloadUrl, deadlineNanos, operation)
    try {
      connection.readTimeout = remainingTimeoutMs(deadlineNanos)
      receiveResponseHeaders(connection, deadlineNanos, operation)
      val input = responseStream(connection)
      var total = 0L
      var firstByteAtNanos: Long? = null
      var finishedAtNanos = SystemClock.elapsedRealtimeNanos()
      if (input != null) {
        input.use { stream ->
          val buffer = ByteArray(BUFFER_SIZE)
          while (true) {
            ensureWithinDeadline(deadlineNanos, operation)
            val nowNanos = SystemClock.elapsedRealtimeNanos()
            val bodyStarted = firstByteAtNanos
            if (
              bodyStarted != null &&
              DownloadPolicy.shouldStop(
                total,
                nanosToMilliseconds(nowNanos - bodyStarted),
                options.downloadMaxBytes,
                options.downloadMaxDurationMs,
              )
            ) {
              finishedAtNanos = nowNanos
              break
            }

            connection.readTimeout = if (bodyStarted == null) {
              remainingTimeoutMs(deadlineNanos)
            } else {
              minOf(
                remainingTimeoutMs(deadlineNanos),
                remainingDownloadTimeoutMs(bodyStarted, options.downloadMaxDurationMs),
              )
            }
            val allowed = minOf(
              buffer.size.toLong(),
              options.downloadMaxBytes - total,
            ).toInt()
            if (allowed <= 0) {
              finishedAtNanos = nowNanos
              break
            }
            val count = try {
              stream.read(buffer, 0, allowed)
            } catch (error: SocketTimeoutException) {
              val started = firstByteAtNanos
              if (
                started != null &&
                nanosToMilliseconds(SystemClock.elapsedRealtimeNanos() - started) >=
                options.downloadMaxDurationMs
              ) {
                finishedAtNanos = SystemClock.elapsedRealtimeNanos()
                break
              }
              throw error
            }
            if (count < 0) break
            val receivedAtNanos = SystemClock.elapsedRealtimeNanos()
            if (firstByteAtNanos == null) firstByteAtNanos = receivedAtNanos
            total += count
            finishedAtNanos = receivedAtNanos
            onBytesReceived(total)
            ensureWithinDeadline(deadlineNanos, operation)
          }
        }
      }
      val bodyStarted = firstByteAtNanos
      val elapsedMs = if (bodyStarted == null) {
        0.0
      } else {
        nanosToMilliseconds(finishedAtNanos - bodyStarted)
      }
      val downloadError = DownloadPolicy.measurementError(total, elapsedMs)
      val measuredKbps = DownloadPolicy.throughputKbps(total, elapsedMs)
      ensureWithinDeadline(deadlineNanos, operation)
      return DownloadMeasurement(total, measuredKbps, downloadError)
    } finally {
      operation.clearConnection(connection)
      // Throughput is the final request, so explicitly close its socket after the body/cap.
      connection.disconnect()
    }
  }

  private fun openConnection(
    network: Network,
    url: URL,
    deadlineNanos: Long,
    operation: ProbeOperation,
  ): HttpURLConnection {
    ensureWithinDeadline(deadlineNanos, operation)
    ensureCookieIsolation()
    val connection = network.openConnection(withCacheBuster(url)) as? HttpURLConnection
      ?: throw IOException("Probe URL did not create an HTTP connection")
    operation.setConnection(connection)
    connection.apply {
      useCaches = false
      defaultUseCaches = false
      instanceFollowRedirects = true
      requestMethod = "GET"
      setRequestProperty("Cache-Control", "no-cache")
      setRequestProperty("Pragma", "no-cache")
      setRequestProperty("Cookie", "")
    }
    return connection
  }

  private fun receiveResponseHeaders(
    connection: HttpURLConnection,
    deadlineNanos: Long,
    operation: ProbeOperation,
  ): HeaderTiming {
    ensureWithinDeadline(deadlineNanos, operation)
    ensureCookieIsolation()
    connection.connectTimeout = remainingTimeoutMs(deadlineNanos)
    connection.readTimeout = remainingTimeoutMs(deadlineNanos)

    val startedNanos = SystemClock.elapsedRealtimeNanos()
    connection.connect()
    ensureWithinDeadline(deadlineNanos, operation)
    ensureCookieIsolation()

    // connect and waiting for response headers share one deadline, rather than each
    // receiving the original timeout as an independent budget.
    connection.readTimeout = remainingTimeoutMs(deadlineNanos)
    connection.responseCode
    val receivedNanos = SystemClock.elapsedRealtimeNanos()
    ensureWithinDeadline(deadlineNanos, operation)
    ensureCookieIsolation()
    return HeaderTiming(startedNanos, receivedNanos)
  }

  private fun readResponseFully(
    connection: HttpURLConnection,
    deadlineNanos: Long,
    operation: ProbeOperation,
  ) {
    connection.readTimeout = remainingTimeoutMs(deadlineNanos)
    responseStream(connection)?.use { stream ->
      val buffer = ByteArray(BUFFER_SIZE)
      while (true) {
        ensureWithinDeadline(deadlineNanos, operation)
        connection.readTimeout = remainingTimeoutMs(deadlineNanos)
        val count = stream.read(buffer)
        ensureWithinDeadline(deadlineNanos, operation)
        if (count < 0) break
      }
    }
  }

  /**
   * HttpURLConnection only exposes a process-wide CookieHandler. Mutating it, even briefly,
   * could race unrelated host-app requests, so probes fail closed when one is installed.
   */
  private fun ensureCookieIsolation() {
    val processHandler = try {
      CookieHandler.getDefault()
    } catch (error: SecurityException) {
      throw CookieIsolationException(
        "Cannot verify process-wide cookie isolation for the network probe",
        error,
      )
    }
    if (processHandler != null) {
      throw CookieIsolationException(
        "Network probe refused to use the host app's process-wide CookieHandler"
      )
    }
  }

  private fun responseStream(connection: HttpURLConnection) = try {
    connection.inputStream
  } catch (error: IOException) {
    connection.errorStream ?: throw error
  }

  private fun remainingTimeoutMs(deadlineNanos: Long): Int {
    val remainingNanos = deadlineNanos - SystemClock.elapsedRealtimeNanos()
    if (remainingNanos <= 0L) throw ProbeTimeoutException()
    return ceil(remainingNanos.toDouble() / NANOS_PER_MILLISECOND)
      .coerceAtMost(Int.MAX_VALUE.toDouble())
      .toInt()
      .coerceAtLeast(1)
  }

  private fun remainingDownloadTimeoutMs(
    firstByteAtNanos: Long,
    maximumDurationMs: Long,
  ): Int {
    val elapsedNanos = SystemClock.elapsedRealtimeNanos() - firstByteAtNanos
    val remainingNanos = maximumDurationMs * NANOS_PER_MILLISECOND - elapsedNanos
    if (remainingNanos <= 0L) return 1
    return ceil(remainingNanos.toDouble() / NANOS_PER_MILLISECOND)
      .coerceAtMost(Int.MAX_VALUE.toDouble())
      .toInt()
      .coerceAtLeast(1)
  }

  private fun ensureWithinDeadline(deadlineNanos: Long, operation: ProbeOperation) {
    if (operation.hasTimedOut || SystemClock.elapsedRealtimeNanos() >= deadlineNanos) {
      throw ProbeTimeoutException()
    }
    if (invalidated || operation.isCancelled || Thread.currentThread().isInterrupted) {
      throw IOException("Probe cancelled")
    }
  }

  private fun isTimeout(
    error: Exception,
    deadlineNanos: Long,
    operation: ProbeOperation,
  ): Boolean =
    error is ProbeTimeoutException ||
      error is SocketTimeoutException ||
      operation.hasTimedOut ||
      SystemClock.elapsedRealtimeNanos() >= deadlineNanos

  private fun parseOptions(options: ReadableMap): ProbeOptions {
    val latencyUrl = parseHttpUrl(options.getString("latencyUrl"), "latencyUrl")
    val downloadUrl = if (options.isNull("downloadUrl")) {
      null
    } else {
      parseHttpUrl(options.getString("downloadUrl"), "downloadUrl")
    }
    val latencySamplesValue = options.getDouble("latencySamples")
    val timeoutValue = options.getDouble("timeoutMs")
    val downloadMaxDurationValue = options.getDouble("downloadMaxDurationMs")
    val downloadMaxBytesValue = options.getDouble("downloadMaxBytes")
    require(latencySamplesValue.isFinite() && latencySamplesValue % 1.0 == 0.0) {
      "latencySamples must be an integer"
    }
    val latencySamples = latencySamplesValue.toInt()
    require(latencySamples in 1..MAX_LATENCY_SAMPLES) {
      "latencySamples must be between 1 and $MAX_LATENCY_SAMPLES"
    }
    require(timeoutValue.isFinite() && timeoutValue > 0 && timeoutValue <= Int.MAX_VALUE) {
      "timeoutMs must be greater than 0 and at most ${Int.MAX_VALUE}"
    }
    require(
      downloadMaxDurationValue.isFinite() &&
        downloadMaxDurationValue > 0 &&
        downloadMaxDurationValue <= Int.MAX_VALUE
    ) {
      "downloadMaxDurationMs must be greater than 0 and at most ${Int.MAX_VALUE}"
    }
    require(
      downloadMaxBytesValue.isFinite() &&
        downloadMaxBytesValue % 1.0 == 0.0 &&
        downloadMaxBytesValue > 0 &&
        downloadMaxBytesValue <= Int.MAX_VALUE
    ) {
      "downloadMaxBytes must be an integer between 1 and ${Int.MAX_VALUE}"
    }
    return ProbeOptions(
      latencyUrl,
      downloadUrl,
      latencySamples,
      ceil(timeoutValue).toLong(),
      ceil(downloadMaxDurationValue).toLong(),
      downloadMaxBytesValue.toLong(),
    )
  }

  private fun parseHttpUrl(rawValue: String?, optionName: String): URL {
    val value = rawValue?.trim().orEmpty()
    val uri = try {
      URI(value)
    } catch (error: Exception) {
      throw InvalidUrlException("$optionName must be a valid HTTP or HTTPS URL", error)
    }
    val scheme = uri.scheme?.lowercase()
    if ((scheme != "http" && scheme != "https") || uri.host.isNullOrBlank()) {
      throw InvalidUrlException("$optionName must use http or https and include a host")
    }
    return try {
      uri.toURL()
    } catch (error: Exception) {
      throw InvalidUrlException("$optionName must be a valid HTTP or HTTPS URL", error)
    }
  }

  private fun withCacheBuster(url: URL): URL {
    val external = url.toExternalForm()
    val fragmentIndex = external.indexOf('#')
    val base = if (fragmentIndex >= 0) external.substring(0, fragmentIndex) else external
    val fragment = if (fragmentIndex >= 0) external.substring(fragmentIndex) else ""
    val separator = if (base.contains('?')) '&' else '?'
    @Suppress("DEPRECATION")
    return URL("$base${separator}_nq=${UUID.randomUUID()}$fragment")
  }

  private fun nanosToMilliseconds(nanos: Long): Double =
    nanos.toDouble() / NANOS_PER_MILLISECOND

  private fun messageFor(error: Exception): String =
    error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName

  private data class ProbeOptions(
    val latencyUrl: URL,
    val downloadUrl: URL?,
    val latencySamples: Int,
    val timeoutMs: Long,
    val downloadMaxDurationMs: Long,
    val downloadMaxBytes: Long,
  )

  private data class DownloadMeasurement(
    val bytesReceived: Long,
    val downlinkKbps: Double?,
    val downloadError: String?,
  )

  private data class HeaderTiming(
    val startedNanos: Long,
    val receivedNanos: Long,
  )

  private class ProbeOperation(
    private val executor: ExecutorService,
    private val timeoutExecutor: ScheduledExecutorService,
    private val promise: Promise,
  ) {
    private val cancelled = AtomicBoolean(false)
    private val timedOut = AtomicBoolean(false)
    private val settled = AtomicBoolean(false)
    private val activeConnection = AtomicReference<HttpURLConnection?>(null)
    private val timeoutFuture = AtomicReference<ScheduledFuture<*>?>(null)

    val isCancelled: Boolean
      get() = cancelled.get()

    val hasTimedOut: Boolean
      get() = timedOut.get()

    fun armTimeout(timeoutMs: Long) {
      val future = timeoutExecutor.schedule(
        {
          timedOut.set(true)
          activeConnection.getAndSet(null)?.disconnect()
          executor.shutdownNow()
        },
        timeoutMs,
        TimeUnit.MILLISECONDS,
      )
      timeoutFuture.set(future)
    }

    fun setConnection(connection: HttpURLConnection) {
      activeConnection.set(connection)
      if (cancelled.get()) {
        activeConnection.compareAndSet(connection, null)
        connection.disconnect()
        throw IOException("Probe cancelled")
      }
    }

    fun clearConnection(connection: HttpURLConnection) {
      activeConnection.compareAndSet(connection, null)
    }

    fun resolve(value: Any?) {
      if (settled.compareAndSet(false, true)) promise.resolve(value)
    }

    fun reject(code: String, message: String?, error: Throwable? = null) {
      if (settled.compareAndSet(false, true)) promise.reject(code, message, error)
    }

    fun cancel(message: String, error: Throwable? = null) {
      cancelled.set(true)
      timeoutFuture.getAndSet(null)?.cancel(false)
      activeConnection.getAndSet(null)?.disconnect()
      executor.shutdownNow()
      timeoutExecutor.shutdownNow()
      reject(ERROR_PROBE_FAILED, message, error)
    }

    fun finish() {
      timeoutFuture.getAndSet(null)?.cancel(false)
      activeConnection.getAndSet(null)?.disconnect()
      executor.shutdown()
      timeoutExecutor.shutdownNow()
    }
  }

  private class ProbeTimeoutException : IOException("Probe deadline exceeded")

  private class CookieIsolationException(message: String, cause: Throwable? = null) :
    IOException(message, cause)

  private class InvalidUrlException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

  companion object {
    private const val ERROR_INVALID_URL = "E_INVALID_URL"
    private const val ERROR_OFFLINE = "E_OFFLINE"
    private const val ERROR_PROBE_TIMEOUT = "E_PROBE_TIMEOUT"
    private const val ERROR_PROBE_FAILED = "E_PROBE_FAILED"
    private const val NANOS_PER_MILLISECOND = 1_000_000L
    private const val BUFFER_SIZE = 16 * 1024
    private const val MAX_LATENCY_SAMPLES = 100
  }
}
