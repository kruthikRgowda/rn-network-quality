package com.rnnetworkquality

internal object DownloadPolicy {
  const val MINIMUM_BYTES = 64 * 1_024L
  const val MINIMUM_DURATION_MS = 100.0

  fun shouldStop(
    bytesReceived: Long,
    elapsedMs: Double,
    maximumBytes: Long,
    maximumDurationMs: Long,
  ): Boolean = bytesReceived >= maximumBytes || elapsedMs >= maximumDurationMs

  fun measurementError(bytesReceived: Long, elapsedMs: Double): String? = when {
    bytesReceived < MINIMUM_BYTES -> "too-little-data"
    elapsedMs < MINIMUM_DURATION_MS -> "too-fast-to-measure"
    else -> null
  }

  fun throughputKbps(bytesReceived: Long, elapsedMs: Double): Double? =
    if (measurementError(bytesReceived, elapsedMs) == null) {
      bytesReceived * 8.0 / elapsedMs
    } else {
      null
    }
}
