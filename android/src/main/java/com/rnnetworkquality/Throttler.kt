package com.rnnetworkquality

internal fun interface Cancellable {
  fun cancel()
}

internal fun interface Clock {
  fun nowMs(): Long
}

internal fun interface Scheduler {
  fun schedule(delayMs: Long, task: () -> Unit): Cancellable
}

/**
 * De-duplicates snapshots and applies leading/trailing throttling to minor signal changes.
 * All calls must be serialized by the owner; the class itself has no platform dependencies.
 */
internal class Throttler(
  private val clock: Clock,
  private val scheduler: Scheduler,
  private val emit: (NetworkSnapshot) -> Unit,
  throttleMs: Long,
  bandwidthChangeThresholdPct: Double,
) {
  private var throttleMs = throttleMs.coerceAtLeast(0L)
  private var bandwidthChangeThresholdPct = bandwidthChangeThresholdPct.coerceAtLeast(0.0)
  private var lastEmitted: NetworkSnapshot? = null
  private var lastEmitTime = 0L
  private var pending: NetworkSnapshot? = null
  private var timer: Cancellable? = null

  fun updateOptions(throttleMs: Long, bandwidthChangeThresholdPct: Double) {
    this.throttleMs = throttleMs.coerceAtLeast(0L)
    this.bandwidthChangeThresholdPct = bandwidthChangeThresholdPct.coerceAtLeast(0.0)

    val latestPending = pending ?: return
    cancelPending()
    submit(latestPending)
  }

  fun submit(snapshot: NetworkSnapshot) {
    val previous = lastEmitted
    if (previous == null) {
      emitNow(snapshot)
      return
    }

    if (snapshot.equalsIgnoringTimestamp(previous)) {
      cancelPending()
      return
    }

    if (Mappers.isSignificantChange(previous, snapshot)) {
      cancelPending()
      emitNow(snapshot)
      return
    }

    if (!Mappers.exceedsAnyMinorThreshold(previous, snapshot, bandwidthChangeThresholdPct)) {
      cancelPending()
      return
    }

    val elapsed = (clock.nowMs() - lastEmitTime).coerceAtLeast(0L)
    if (elapsed >= throttleMs) {
      cancelPending()
      emitNow(snapshot)
      return
    }

    pending = snapshot
    if (timer == null) {
      timer = scheduler.schedule(throttleMs - elapsed) {
        timer = null
        val trailing = pending
        pending = null
        if (trailing != null) emitNow(trailing)
      }
    }
  }

  fun reset() {
    cancelPending()
    lastEmitted = null
    lastEmitTime = 0L
  }

  private fun emitNow(snapshot: NetworkSnapshot) {
    lastEmitted = snapshot
    lastEmitTime = clock.nowMs()
    emit(snapshot)
  }

  private fun cancelPending() {
    timer?.cancel()
    timer = null
    pending = null
  }
}
