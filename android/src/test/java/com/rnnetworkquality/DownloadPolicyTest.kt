package com.rnnetworkquality

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadPolicyTest {
  @Test
  fun `byte cap stops a download before the time cap`() {
    assertFalse(
      DownloadPolicy.shouldStop(
        bytesReceived = 2_999_999,
        elapsedMs = 500.0,
        maximumBytes = 3_000_000,
        maximumDurationMs = 3_000,
      )
    )
    assertTrue(
      DownloadPolicy.shouldStop(
        bytesReceived = 3_000_000,
        elapsedMs = 500.0,
        maximumBytes = 3_000_000,
        maximumDurationMs = 3_000,
      )
    )
  }

  @Test
  fun `time cap stops a download before the byte cap`() {
    assertFalse(
      DownloadPolicy.shouldStop(
        bytesReceived = 500_000,
        elapsedMs = 2_999.9,
        maximumBytes = 3_000_000,
        maximumDurationMs = 3_000,
      )
    )
    assertTrue(
      DownloadPolicy.shouldStop(
        bytesReceived = 500_000,
        elapsedMs = 3_000.0,
        maximumBytes = 3_000_000,
        maximumDurationMs = 3_000,
      )
    )
  }
}
