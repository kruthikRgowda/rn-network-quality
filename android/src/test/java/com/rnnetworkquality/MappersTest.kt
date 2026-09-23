package com.rnnetworkquality

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MappersTest {
  @Test
  fun `transport mapping follows priority and preserves VPN presence`() {
    assertEquals(
      Mappers.TransportMapping(transport = "wifi", isVpn = true),
      Mappers.mapTransport(
        hasNetwork = true,
        hasWifi = true,
        hasCellular = false,
        hasEthernet = false,
        hasUsb = false,
        hasBluetooth = false,
        hasVpn = true,
      ),
    )

    assertEquals("cellular", transport(cellular = true, vpn = true).transport)
    assertEquals("ethernet", transport(ethernet = true, vpn = true).transport)
    assertEquals("ethernet", transport(usb = true, vpn = true).transport)
    assertEquals("bluetooth", transport(bluetooth = true, vpn = true).transport)
    assertEquals(Mappers.TransportMapping("vpn", true), transport(vpn = true))
    assertEquals(Mappers.TransportMapping("other", false), transport())
    assertEquals(
      Mappers.TransportMapping("none", false),
      transport(hasNetwork = false, wifi = true, vpn = true),
    )
  }

  @Test
  fun `cellular generation maps every documented Android network type`() {
    listOf(1, 2, 4, 7, 11, 16).forEach {
      assertEquals("NETWORK_TYPE_$it", "2g", Mappers.mapCellularGeneration(it))
    }
    listOf(3, 5, 6, 8, 9, 10, 12, 14, 15, 17).forEach {
      assertEquals("NETWORK_TYPE_$it", "3g", Mappers.mapCellularGeneration(it))
    }
    listOf(13, 18).forEach {
      assertEquals("NETWORK_TYPE_$it", "4g", Mappers.mapCellularGeneration(it))
    }
    assertEquals("5g", Mappers.mapCellularGeneration(20))
    assertNull(Mappers.mapCellularGeneration(0))
    assertNull(Mappers.mapCellularGeneration(19))
    assertNull(Mappers.mapCellularGeneration(Int.MAX_VALUE))
  }

  @Test
  fun `significant changes exclude timestamp and the three numeric signals`() {
    val initial = snapshot()
    assertTrue(Mappers.isSignificantChange(null, initial))
    assertFalse(Mappers.isSignificantChange(initial, initial.copy(timestamp = 2)))
    assertFalse(
      Mappers.isSignificantChange(
        initial,
        initial.copy(downlinkKbps = 2_000, uplinkKbps = 750, signalStrength = -70),
      )
    )
    assertTrue(Mappers.isSignificantChange(initial, initial.copy(transport = "cellular")))
    assertTrue(Mappers.isSignificantChange(initial, initial.copy(isValidated = false)))
    assertTrue(Mappers.isSignificantChange(initial, initial.copy(isConstrained = true)))
  }

  @Test
  fun `threshold math handles exact boundaries zero negatives and null transitions`() {
    assertFalse(Mappers.exceedsThreshold(1_000, 1_099, 10.0))
    assertTrue(Mappers.exceedsThreshold(1_000, 1_100, 10.0))
    assertTrue(Mappers.exceedsThreshold(1_000, 900, 10.0))
    assertFalse(Mappers.exceedsThreshold(-100, -91, 10.0))
    assertTrue(Mappers.exceedsThreshold(-100, -90, 10.0))
    assertFalse(Mappers.exceedsThreshold(0, 0, 10.0))
    assertTrue(Mappers.exceedsThreshold(0, 1, 10.0))
    assertTrue(Mappers.exceedsThreshold(null, 1, 10.0))
    assertTrue(Mappers.exceedsThreshold(1, null, 10.0))
    assertFalse(Mappers.exceedsThreshold(null, null, 10.0))
  }

  private fun transport(
    hasNetwork: Boolean = true,
    wifi: Boolean = false,
    cellular: Boolean = false,
    ethernet: Boolean = false,
    usb: Boolean = false,
    bluetooth: Boolean = false,
    vpn: Boolean = false,
  ): Mappers.TransportMapping = Mappers.mapTransport(
    hasNetwork,
    wifi,
    cellular,
    ethernet,
    usb,
    bluetooth,
    vpn,
  )

  private fun snapshot() = NetworkSnapshot(
    isConnected = true,
    isValidated = true,
    isCaptivePortal = false,
    transport = "wifi",
    isVpn = false,
    isExpensive = false,
    isConstrained = false,
    isRoaming = false,
    downlinkKbps = 1_000,
    uplinkKbps = 500,
    signalStrength = -80,
    cellularGeneration = null,
    supportsIPv4 = true,
    supportsIPv6 = true,
    supportsDNS = true,
    unsatisfiedReason = null,
    timestamp = 1,
  )
}
