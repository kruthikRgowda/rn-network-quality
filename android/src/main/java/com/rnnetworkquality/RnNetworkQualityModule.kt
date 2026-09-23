package com.rnnetworkquality

import com.facebook.react.bridge.ReactApplicationContext

class RnNetworkQualityModule(reactContext: ReactApplicationContext) :
  NativeRnNetworkQualitySpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeRnNetworkQualitySpec.NAME
  }
}
