package com.rnnetworkquality

import kotlin.math.abs

/** Pure platform-value mappings shared by the Android implementation and JVM tests. */
internal object Mappers {
  data class TransportMapping(
    val transport: String,
    val isVpn: Boolean,
  )

  fun mapTransport(
    hasNetwork: Boolean,
    hasWifi: Boolean,
    hasCellular: Boolean,
    hasEthernet: Boolean,
    hasUsb: Boolean,
    hasBluetooth: Boolean,
    hasVpn: Boolean,
  ): TransportMapping {
    val transport = when {
      !hasNetwork -> "none"
      hasWifi -> "wifi"
      hasCellular -> "cellular"
      hasEthernet || hasUsb -> "ethernet"
      hasBluetooth -> "bluetooth"
      hasVpn -> "vpn"
      else -> "other"
    }
    return TransportMapping(
      transport = transport,
      isVpn = hasNetwork && hasVpn,
    )
  }

  /** Maps TelephonyManager.NETWORK_TYPE_* integer values without Android dependencies. */
  fun mapCellularGeneration(networkType: Int): String? = when (networkType) {
    1, // GPRS
    2, // EDGE
    4, // CDMA
    7, // 1xRTT
    11, // IDEN
    16, // GSM
    -> "2g"

    3, // UMTS
    5, // EVDO_0
    6, // EVDO_A
    8, // HSDPA
    9, // HSUPA
    10, // HSPA
    12, // EVDO_B
    14, // EHRPD
    15, // HSPAP
    17, // TD_SCDMA
    -> "3g"

    13, // LTE
    18, // IWLAN
    -> "4g"

    20, // NR
    -> "5g"

    else -> null
  }

  fun isSignificantChange(
    previous: NetworkSnapshot?,
    current: NetworkSnapshot,
  ): Boolean {
    if (previous == null) return true

    return previous.isConnected != current.isConnected ||
      previous.isValidated != current.isValidated ||
      previous.isCaptivePortal != current.isCaptivePortal ||
      previous.transport != current.transport ||
      previous.isVpn != current.isVpn ||
      previous.isExpensive != current.isExpensive ||
      previous.isConstrained != current.isConstrained ||
      previous.isRoaming != current.isRoaming ||
      previous.cellularGeneration != current.cellularGeneration ||
      previous.supportsIPv4 != current.supportsIPv4 ||
      previous.supportsIPv6 != current.supportsIPv6 ||
      previous.supportsDNS != current.supportsDNS ||
      previous.unsatisfiedReason != current.unsatisfiedReason
  }

  fun exceedsThreshold(oldValue: Int?, newValue: Int?, thresholdPct: Double): Boolean {
    if (oldValue == newValue) return false
    if (oldValue == null || newValue == null) return true
    if (oldValue == 0) return newValue != 0

    val percentChange = abs(newValue.toDouble() - oldValue) / abs(oldValue.toDouble()) * 100.0
    return percentChange >= thresholdPct.coerceAtLeast(0.0)
  }

  fun exceedsAnyMinorThreshold(
    previous: NetworkSnapshot,
    current: NetworkSnapshot,
    thresholdPct: Double,
  ): Boolean =
    exceedsThreshold(previous.downlinkKbps, current.downlinkKbps, thresholdPct) ||
      exceedsThreshold(previous.uplinkKbps, current.uplinkKbps, thresholdPct) ||
      exceedsThreshold(previous.signalStrength, current.signalStrength, thresholdPct)
}
