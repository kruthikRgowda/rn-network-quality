package com.rnnetworkquality

import org.junit.Assert.assertEquals
import org.junit.Test

class ThrottlerTest {
  @Test
  fun `identical snapshot ignoring timestamp is dropped`() {
    val harness = Harness()
    val first = snapshot()

    harness.throttler.submit(first)
    harness.throttler.submit(first.copy(timestamp = 99))

    assertEquals(listOf(first), harness.emitted)
  }

  @Test
  fun `significant change emits immediately inside throttle window`() {
    val harness = Harness()
    harness.throttler.submit(snapshot())
    harness.clock.timeMs = 100

    val cellular = snapshot(transport = "cellular", downlinkKbps = 1_050, timestamp = 2)
    harness.throttler.submit(cellular)

    assertEquals(listOf("wifi", "cellular"), harness.emitted.map { it.transport })
  }

  @Test
  fun `minor change below percentage threshold is dropped`() {
    val harness = Harness(thresholdPct = 10.0)
    harness.throttler.submit(snapshot(downlinkKbps = 1_000))
    harness.clock.timeMs = 100

    harness.throttler.submit(snapshot(downlinkKbps = 1_099, timestamp = 2))
    harness.scheduler.advanceBy(2_000)

    assertEquals(1, harness.emitted.size)
  }

  @Test
  fun `trailing emit carries the latest pending snapshot`() {
    val harness = Harness(throttleMs = 1_000, thresholdPct = 10.0)
    harness.throttler.submit(snapshot(downlinkKbps = 1_000))
    harness.scheduler.advanceBy(100)
    harness.throttler.submit(snapshot(downlinkKbps = 1_200, timestamp = 2))
    harness.scheduler.advanceBy(100)
    val latest = snapshot(downlinkKbps = 1_500, timestamp = 3)
    harness.throttler.submit(latest)

    harness.scheduler.advanceBy(799)
    assertEquals(1, harness.emitted.size)
    harness.scheduler.advanceBy(1)

    assertEquals(listOf(1_000, 1_500), harness.emitted.map { it.downlinkKbps })
    assertEquals(latest, harness.emitted.last())
  }

  @Test
  fun `significant change cancels a pending trailing timer`() {
    val harness = Harness(throttleMs = 1_000, thresholdPct = 10.0)
    harness.throttler.submit(snapshot(downlinkKbps = 1_000))
    harness.scheduler.advanceBy(100)
    harness.throttler.submit(snapshot(downlinkKbps = 1_500, timestamp = 2))

    val constrained = snapshot(
      downlinkKbps = 1_600,
      isConstrained = true,
      timestamp = 3,
    )
    harness.throttler.submit(constrained)
    harness.scheduler.advanceBy(2_000)

    assertEquals(2, harness.emitted.size)
    assertEquals(constrained, harness.emitted.last())
  }

  private class Harness(
    throttleMs: Long = 1_000,
    thresholdPct: Double = 10.0,
  ) {
    val clock = FakeClock()
    val scheduler = FakeScheduler(clock)
    val emitted = mutableListOf<NetworkSnapshot>()
    val throttler = Throttler(
      clock = clock,
      scheduler = scheduler,
      emit = emitted::add,
      throttleMs = throttleMs,
      bandwidthChangeThresholdPct = thresholdPct,
    )
  }

  private class FakeClock(var timeMs: Long = 0) : Clock {
    override fun nowMs(): Long = timeMs
  }

  private class FakeScheduler(private val clock: FakeClock) : Scheduler {
    private val entries = mutableListOf<Entry>()

    override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
      val entry = Entry(clock.timeMs + delayMs, task)
      entries += entry
      return Cancellable { entry.cancelled = true }
    }

    fun advanceBy(deltaMs: Long) {
      val target = clock.timeMs + deltaMs
      while (true) {
        val next = entries
          .filter { !it.cancelled && it.dueMs <= target }
          .minByOrNull { it.dueMs }
          ?: break
        entries.remove(next)
        clock.timeMs = next.dueMs
        next.task()
      }
      clock.timeMs = target
    }

    private data class Entry(
      val dueMs: Long,
      val task: () -> Unit,
      var cancelled: Boolean = false,
    )
  }

  companion object {
    private fun snapshot(
      transport: String = "wifi",
      downlinkKbps: Int? = 1_000,
      isConstrained: Boolean = false,
      timestamp: Long = 1,
    ) = NetworkSnapshot(
      isConnected = true,
      isValidated = true,
      isCaptivePortal = false,
      transport = transport,
      isVpn = false,
      isExpensive = false,
      isConstrained = isConstrained,
      isRoaming = false,
      downlinkKbps = downlinkKbps,
      uplinkKbps = 500,
      signalStrength = -80,
      cellularGeneration = null,
      supportsIPv4 = true,
      supportsIPv6 = true,
      supportsDNS = true,
      unsatisfiedReason = null,
      timestamp = timestamp,
    )
  }
}
