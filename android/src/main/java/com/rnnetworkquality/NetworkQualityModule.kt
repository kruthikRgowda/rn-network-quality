package com.rnnetworkquality

import android.content.Context
import android.net.ConnectivityManager
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap

internal class NetworkQualityModule(
  private val reactContext: ReactApplicationContext,
) : NativeNetworkQualitySpec(reactContext) {
  private val lifecycleLock = Any()
  private val connectivityManager =
    reactContext.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val snapshotBuilder = SnapshotBuilder(
    connectivityManager,
    CellularInfo(reactContext),
  )
  private val networkProbe = NetworkProbe(reactContext)

  @Volatile
  private var invalidated = false
  private var nextGeneration = 0L
  private var worker: MonitorRuntime? = null

  override fun getName(): String = NAME

  override fun getCurrentState(promise: Promise) {
    if (invalidated) {
      promise.reject(ERROR_STATE_FAILED, "NetworkQuality has been invalidated")
      return
    }

    val runtime = synchronized(lifecycleLock) {
      if (invalidated) {
        null
      } else {
        ensureRuntimeLocked().also { it.pendingSnapshots += 1 }
      }
    }
    if (runtime == null) {
      promise.reject(ERROR_STATE_FAILED, "NetworkQuality has been invalidated")
      return
    }

    if (!runtime.handler.post {
        try {
          resolveCurrentState(runtime.monitor, promise)
        } finally {
          completeSnapshot(runtime)
        }
      }
    ) {
      discardUnavailableRuntime(runtime)
      promise.reject(ERROR_STATE_FAILED, "The network snapshot thread is unavailable")
    }
  }

  override fun startMonitoring(options: ReadableMap) {
    if (invalidated) return
    val throttleMs = options.readFiniteDouble("throttleMs", DEFAULT_THROTTLE_MS).toLong()
      .coerceAtLeast(0L)
    val threshold = options.readFiniteDouble(
      "bandwidthChangeThresholdPct",
      DEFAULT_THRESHOLD_PERCENT,
    ).coerceAtLeast(0.0)

    val request = synchronized(lifecycleLock) {
      if (invalidated) return
      val runtime = ensureRuntimeLocked()
      runtime.monitoring = true
      runtime.commandVersion += 1
      StartRequest(runtime, runtime.commandVersion)
    }
    if (!request.runtime.handler.post {
        if (!isCurrentStart(request)) return@post
        try {
          if (!request.runtime.monitor.start(throttleMs, threshold)) {
            completeFailedStart(request)
          }
        } catch (error: RuntimeException) {
          Log.w(TAG, "Unable to start network monitoring", error)
          try {
            request.runtime.monitor.stop()
          } catch (cleanupError: RuntimeException) {
            Log.w(TAG, "Unable to roll back network monitoring", cleanupError)
          }
          completeFailedStart(request)
        }
      }
    ) {
      discardUnavailableRuntime(request.runtime)
    }
  }

  override fun stopMonitoring() {
    networkProbe.cancelActive()
    val runtime = synchronized(lifecycleLock) {
      val current = worker ?: return
      if (!current.monitoring) return
      current.monitoring = false
      current.commandVersion += 1
      current.stopPending = true
      current
    }
    if (!runtime.handler.post {
        try {
          runtime.monitor.stop()
        } catch (error: RuntimeException) {
          Log.w(TAG, "Unable to stop network monitoring", error)
        } finally {
          completeStop(runtime)
        }
      }
    ) {
      discardUnavailableRuntime(runtime)
    }
  }

  override fun probe(options: ReadableMap, promise: Promise) {
    if (invalidated) {
      promise.reject(ERROR_PROBE_FAILED, "NetworkQuality has been invalidated")
      return
    }
    networkProbe.probe(options, promise)
  }

  override fun invalidate() {
    val runtime = synchronized(lifecycleLock) {
      if (invalidated) return
      invalidated = true
      worker.also { current ->
        worker = null
        current?.monitoring = false
        current?.stopPending = true
        current?.commandVersion = (current?.commandVersion ?: 0L) + 1
      }
    }
    networkProbe.invalidate()
    if (runtime != null) {
      if (!runtime.handler.post {
          try {
            runtime.monitor.stop()
          } catch (error: RuntimeException) {
            Log.w(TAG, "Unable to invalidate network monitoring", error)
          } finally {
            runtime.thread.quitSafely()
          }
        }
      ) {
        runtime.thread.quitSafely()
      }
    }
    super.invalidate()
  }

  /** Called with [lifecycleLock] held. At most one serialized handler exists at a time. */
  private fun ensureRuntimeLocked(): MonitorRuntime {
    worker?.let { return it }
    val generation = ++nextGeneration
    val thread = HandlerThread(MONITOR_THREAD_NAME).apply { start() }
    val handler = Handler(thread.looper)
    val monitor = NetworkMonitor(
      context = reactContext,
      connectivityManager = connectivityManager,
      handler = handler,
      snapshotBuilder = snapshotBuilder,
      onSnapshot = { snapshot -> emitSnapshot(generation, snapshot) },
    )
    return MonitorRuntime(generation, thread, handler, monitor).also { worker = it }
  }

  private fun completeSnapshot(runtime: MonitorRuntime) {
    synchronized(lifecycleLock) {
      if (runtime.pendingSnapshots > 0) runtime.pendingSnapshots -= 1
    }
    releaseIfIdle(runtime)
  }

  private fun completeStop(runtime: MonitorRuntime) {
    synchronized(lifecycleLock) {
      runtime.stopPending = false
    }
    releaseIfIdle(runtime)
  }

  private fun completeFailedStart(request: StartRequest) {
    synchronized(lifecycleLock) {
      if (
        worker === request.runtime &&
        request.runtime.commandVersion == request.commandVersion
      ) {
        request.runtime.monitoring = false
      }
    }
    releaseIfIdle(request.runtime)
  }

  private fun releaseIfIdle(runtime: MonitorRuntime) {
    val shouldRelease = synchronized(lifecycleLock) {
      if (
        worker === runtime &&
        !runtime.monitoring &&
        !runtime.stopPending &&
        runtime.pendingSnapshots == 0
      ) {
        worker = null
        true
      } else {
        false
      }
    }
    if (shouldRelease) runtime.thread.quitSafely()
  }

  private fun discardUnavailableRuntime(runtime: MonitorRuntime) {
    synchronized(lifecycleLock) {
      if (worker === runtime) worker = null
      runtime.monitoring = false
      runtime.stopPending = false
      runtime.pendingSnapshots = 0
    }
    runtime.thread.quitSafely()
  }

  private fun isCurrentStart(request: StartRequest): Boolean = synchronized(lifecycleLock) {
    !invalidated &&
      worker === request.runtime &&
      request.runtime.monitoring &&
      request.runtime.commandVersion == request.commandVersion
  }

  private fun resolveCurrentState(monitor: NetworkMonitor, promise: Promise) {
    try {
      promise.resolve(monitor.readCurrentSnapshot().toWritableMap())
    } catch (error: RuntimeException) {
      promise.reject(ERROR_STATE_FAILED, "Unable to read the current network state", error)
    }
  }

  private fun emitSnapshot(generation: Long, snapshot: NetworkSnapshot) {
    val canEmit = synchronized(lifecycleLock) {
      !invalidated && worker?.generation == generation && worker?.monitoring == true
    }
    if (!canEmit) return
    try {
      emitOnNetworkStateChange(snapshot.toWritableMap())
    } catch (error: RuntimeException) {
      Log.w(TAG, "Unable to emit a network state update", error)
    }
  }

  private fun ReadableMap.readFiniteDouble(key: String, fallback: Double): Double = try {
    getDouble(key).takeIf { it.isFinite() } ?: fallback
  } catch (_: RuntimeException) {
    fallback
  }

  private class MonitorRuntime(
    val generation: Long,
    val thread: HandlerThread,
    val handler: Handler,
    val monitor: NetworkMonitor,
    var monitoring: Boolean = false,
    var stopPending: Boolean = false,
    var pendingSnapshots: Int = 0,
    var commandVersion: Long = 0,
  )

  private data class StartRequest(
    val runtime: MonitorRuntime,
    val commandVersion: Long,
  )

  companion object {
    const val NAME = "NetworkQuality"
    private const val TAG = "RNNetworkQuality"
    private const val MONITOR_THREAD_NAME = "RNNetworkQuality"
    private const val DEFAULT_THROTTLE_MS = 1_000.0
    private const val DEFAULT_THRESHOLD_PERCENT = 10.0
    private const val ERROR_STATE_FAILED = "E_PROBE_FAILED"
    private const val ERROR_PROBE_FAILED = "E_PROBE_FAILED"
  }
}
