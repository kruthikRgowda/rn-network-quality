package com.rnnetworkquality

import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import java.net.Inet4Address
import java.net.Inet6Address

/** Converts Android connectivity primitives into the cross-platform snapshot contract. */
internal class SnapshotBuilder(
  private val connectivityManager: ConnectivityManager,
  private val cellularInfo: CellularInfo,
) {
  fun build(
    network: Network?,
    capabilities: NetworkCapabilities?,
    linkProperties: LinkProperties?,
    timestamp: Long = System.currentTimeMillis(),
  ): NetworkSnapshot {
    if (network == null || capabilities == null) {
      return NetworkSnapshot.disconnected(timestamp, isConstrained())
    }

    val hasWifi = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    val hasCellular = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
    val hasEthernet = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    val hasUsb =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_USB)
    val hasBluetooth = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH)
    val hasVpn = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
    val transportMapping = Mappers.mapTransport(
      hasNetwork = true,
      hasWifi = hasWifi,
      hasCellular = hasCellular,
      hasEthernet = hasEthernet,
      hasUsb = hasUsb,
      hasBluetooth = hasBluetooth,
      hasVpn = hasVpn,
    )

    val temporarilyNotMetered =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED)
    val isExpensive =
      !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) &&
        !temporarilyNotMetered

    val downlink = capabilities.linkDownstreamBandwidthKbps.takeIf { it > 0 }
    val uplink = capabilities.linkUpstreamBandwidthKbps.takeIf { it > 0 }
    val signal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      capabilities.signalStrength.takeUnless {
        it == NetworkCapabilities.SIGNAL_STRENGTH_UNSPECIFIED
      }
    } else {
      null
    }

    return NetworkSnapshot(
      isConnected = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
      isValidated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
      isCaptivePortal = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL),
      transport = transportMapping.transport,
      isVpn = transportMapping.isVpn,
      isExpensive = isExpensive,
      isConstrained = isConstrained(),
      isRoaming = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
      } else {
        null
      },
      downlinkKbps = downlink,
      uplinkKbps = uplink,
      signalStrength = signal,
      cellularGeneration = cellularInfo.generation(transportMapping.transport == "cellular"),
      supportsIPv4 = linkProperties?.linkAddresses?.any { it.address is Inet4Address },
      supportsIPv6 = linkProperties?.linkAddresses?.any { it.address is Inet6Address },
      supportsDNS = linkProperties?.dnsServers?.isNotEmpty(),
      unsatisfiedReason = null,
      timestamp = timestamp,
    )
  }

  fun isConstrained(): Boolean = try {
    connectivityManager.restrictBackgroundStatus ==
      ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
  } catch (_: RuntimeException) {
    false
  }
}
