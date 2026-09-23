package com.rnnetworkquality

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/** A complete point-in-time view of Android's default network. */
internal data class NetworkSnapshot(
  val isConnected: Boolean,
  val isValidated: Boolean?,
  val isCaptivePortal: Boolean?,
  val transport: String,
  val isVpn: Boolean?,
  val isExpensive: Boolean,
  val isConstrained: Boolean,
  val isRoaming: Boolean?,
  val downlinkKbps: Int?,
  val uplinkKbps: Int?,
  val signalStrength: Int?,
  val cellularGeneration: String?,
  val supportsIPv4: Boolean?,
  val supportsIPv6: Boolean?,
  val supportsDNS: Boolean?,
  val unsatisfiedReason: String?,
  val timestamp: Long,
) {
  fun equalsIgnoringTimestamp(other: NetworkSnapshot): Boolean =
    copy(timestamp = other.timestamp) == other

  fun toWritableMap(): WritableMap = Arguments.createMap().apply {
    putBoolean("isConnected", isConnected)
    putNullableBoolean("isValidated", isValidated)
    putNullableBoolean("isCaptivePortal", isCaptivePortal)
    putString("transport", transport)
    putNullableBoolean("isVpn", isVpn)
    putBoolean("isExpensive", isExpensive)
    putBoolean("isConstrained", isConstrained)
    putNullableBoolean("isRoaming", isRoaming)
    putNullableNumber("downlinkKbps", downlinkKbps)
    putNullableNumber("uplinkKbps", uplinkKbps)
    putNullableNumber("signalStrength", signalStrength)
    putNullableString("cellularGeneration", cellularGeneration)
    putNullableBoolean("supportsIPv4", supportsIPv4)
    putNullableBoolean("supportsIPv6", supportsIPv6)
    putNullableBoolean("supportsDNS", supportsDNS)
    putNullableString("unsatisfiedReason", unsatisfiedReason)
    putDouble("timestamp", timestamp.toDouble())
  }

  private fun WritableMap.putNullableBoolean(key: String, value: Boolean?) {
    if (value == null) putNull(key) else putBoolean(key, value)
  }

  private fun WritableMap.putNullableNumber(key: String, value: Int?) {
    if (value == null) putNull(key) else putDouble(key, value.toDouble())
  }

  private fun WritableMap.putNullableString(key: String, value: String?) {
    if (value == null) putNull(key) else putString(key, value)
  }

  companion object {
    fun disconnected(timestamp: Long, isConstrained: Boolean): NetworkSnapshot =
      NetworkSnapshot(
        isConnected = false,
        isValidated = false,
        isCaptivePortal = false,
        transport = "none",
        isVpn = false,
        isExpensive = false,
        isConstrained = isConstrained,
        isRoaming = null,
        downlinkKbps = null,
        uplinkKbps = null,
        signalStrength = null,
        cellularGeneration = null,
        supportsIPv4 = null,
        supportsIPv6 = null,
        supportsDNS = null,
        unsatisfiedReason = null,
        timestamp = timestamp,
      )
  }
}
