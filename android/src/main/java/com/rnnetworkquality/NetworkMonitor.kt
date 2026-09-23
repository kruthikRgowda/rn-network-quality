package com.rnnetworkquality

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat

/** Owns the event-driven default-network callback and Data Saver receiver. */
internal class NetworkMonitor(
  context: Context,
  private val connectivityManager: ConnectivityManager,
  private val handler: Handler,
  private val snapshotBuilder: SnapshotBuilder,
  onSnapshot: (NetworkSnapshot) -> Unit,
) {
  private val appContext = context.applicationContext
  private val throttler = Throttler(
    clock = Clock { android.os.SystemClock.elapsedRealtime() },
    scheduler = HandlerScheduler(handler),
    emit = onSnapshot,
    throttleMs = DEFAULT_THROTTLE_MS,
    bandwidthChangeThresholdPct = DEFAULT_THRESHOLD_PERCENT,
  )

  private var running = false
  private var callbackRegistered = false
  private var receiverRegistered = false
  private var latestNetwork: Network? = null
  private var latestCapabilities: NetworkCapabilities? = null
  private var latestLinkProperties: LinkProperties? = null

  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) = dispatch {
      if (!running || currentActiveNetwork() != network) return@dispatch
      latestNetwork = network
      latestCapabilities = safeCapabilities(network)
      latestLinkProperties = safeLinkProperties(network)
      rebuildSnapshot()
    }

    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
      dispatch {
        if (!running || currentActiveNetwork() != network) return@dispatch
        if (latestNetwork != network) {
          latestNetwork = network
          latestLinkProperties = safeLinkProperties(network)
        }
        latestCapabilities = capabilities
        rebuildSnapshot()
      }

    override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) =
      dispatch {
        if (!running || currentActiveNetwork() != network) return@dispatch
        if (latestNetwork != network) {
          latestNetwork = network
          latestCapabilities = safeCapabilities(network)
        }
        latestLinkProperties = linkProperties
        rebuildSnapshot()
      }

    override fun onLost(network: Network) = dispatch {
      if (!running || (latestNetwork != null && latestNetwork != network)) return@dispatch
      val activeNetwork = currentActiveNetwork()
      if (activeNetwork != null && activeNetwork != network) {
        refreshFromSystem()
        return@dispatch
      }
      latestNetwork = null
      latestCapabilities = null
      latestLinkProperties = null
      throttler.submit(
        NetworkSnapshot.disconnected(
          timestamp = System.currentTimeMillis(),
          isConstrained = snapshotBuilder.isConstrained(),
        )
      )
    }

    override fun onBlockedStatusChanged(network: Network, blocked: Boolean) = dispatch {
      if (!running || currentActiveNetwork() != network) return@dispatch
      refreshFromSystem()
    }
  }

  private val dataSaverReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == ConnectivityManager.ACTION_RESTRICT_BACKGROUND_CHANGED) {
        dispatch {
          if (running) refreshFromSystem()
        }
      }
    }
  }

  fun start(throttleMs: Long, bandwidthChangeThresholdPct: Double): Boolean {
    checkHandlerThread()
    throttler.updateOptions(throttleMs, bandwidthChangeThresholdPct)
    if (running) return true

    throttler.reset()
    running = true
    if (!registerNetworkCallback()) {
      refreshFromSystem()
      running = false
      return false
    }
    if (!registerDataSaverReceiver()) {
      unregisterNetworkCallback()
      refreshFromSystem()
      running = false
      return false
    }
    refreshFromSystem()
    return true
  }

  fun stop() {
    checkHandlerThread()
    running = false
    unregisterNetworkCallback()
    unregisterDataSaverReceiver()
    latestNetwork = null
    latestCapabilities = null
    latestLinkProperties = null
    throttler.reset()
  }

  /** Must be called on the monitor handler. Reads current state even when monitoring is stopped. */
  fun readCurrentSnapshot(): NetworkSnapshot {
    checkHandlerThread()
    val network = currentActiveNetwork()
    return snapshotBuilder.build(
      network = network,
      capabilities = network?.let(::safeCapabilities),
      linkProperties = network?.let(::safeLinkProperties),
    )
  }

  private fun registerNetworkCallback(): Boolean = try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      connectivityManager.registerDefaultNetworkCallback(networkCallback, handler)
    } else {
      connectivityManager.registerDefaultNetworkCallback(networkCallback)
    }
    callbackRegistered = true
    true
  } catch (error: RuntimeException) {
    callbackRegistered = false
    Log.w(TAG, "Unable to register default-network callback", error)
    false
  }

  private fun registerDataSaverReceiver(): Boolean = try {
    ContextCompat.registerReceiver(
      appContext,
      dataSaverReceiver,
      IntentFilter(ConnectivityManager.ACTION_RESTRICT_BACKGROUND_CHANGED),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    receiverRegistered = true
    true
  } catch (error: RuntimeException) {
    receiverRegistered = false
    Log.w(TAG, "Unable to register Data Saver receiver", error)
    false
  }

  private fun unregisterNetworkCallback() {
    if (!callbackRegistered) return
    try {
      connectivityManager.unregisterNetworkCallback(networkCallback)
    } catch (error: RuntimeException) {
      Log.w(TAG, "Unable to unregister default-network callback", error)
    } finally {
      callbackRegistered = false
    }
  }

  private fun unregisterDataSaverReceiver() {
    if (!receiverRegistered) return
    try {
      appContext.unregisterReceiver(dataSaverReceiver)
    } catch (error: RuntimeException) {
      Log.w(TAG, "Unable to unregister Data Saver receiver", error)
    } finally {
      receiverRegistered = false
    }
  }

  private fun refreshFromSystem() {
    val network = currentActiveNetwork()
    latestNetwork = network
    latestCapabilities = network?.let(::safeCapabilities)
    latestLinkProperties = network?.let(::safeLinkProperties)
    rebuildSnapshot()
  }

  private fun rebuildSnapshot() {
    throttler.submit(
      snapshotBuilder.build(
        network = latestNetwork,
        capabilities = latestCapabilities,
        linkProperties = latestLinkProperties,
      )
    )
  }

  private fun safeCapabilities(network: Network): NetworkCapabilities? = try {
    connectivityManager.getNetworkCapabilities(network)
  } catch (error: RuntimeException) {
    Log.w(TAG, "Unable to read network capabilities", error)
    null
  }

  private fun safeLinkProperties(network: Network): LinkProperties? = try {
    connectivityManager.getLinkProperties(network)
  } catch (error: RuntimeException) {
    Log.w(TAG, "Unable to read link properties", error)
    null
  }

  private fun currentActiveNetwork(): Network? = try {
    connectivityManager.activeNetwork
  } catch (error: RuntimeException) {
    Log.w(TAG, "Unable to read the active network", error)
    null
  }

  private fun dispatch(block: () -> Unit) {
    if (Looper.myLooper() == handler.looper) block() else handler.post(block)
  }

  private fun checkHandlerThread() {
    check(Looper.myLooper() == handler.looper) {
      "NetworkMonitor must only be accessed from its handler thread"
    }
  }

  private class HandlerScheduler(private val handler: Handler) : Scheduler {
    override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
      val runnable = Runnable(task)
      handler.postDelayed(runnable, delayMs.coerceAtLeast(0L))
      return Cancellable { handler.removeCallbacks(runnable) }
    }
  }

  companion object {
    private const val TAG = "RNNetworkQuality"
    private const val DEFAULT_THROTTLE_MS = 1_000L
    private const val DEFAULT_THRESHOLD_PERCENT = 10.0
  }
}
