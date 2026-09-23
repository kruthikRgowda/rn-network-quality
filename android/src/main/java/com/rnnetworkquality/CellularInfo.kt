package com.rnnetworkquality

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

/** Reads optional cellular generation only when the host app granted phone-state access. */
internal class CellularInfo(context: Context) {
  private val appContext = context.applicationContext
  private val telephonyManager =
    appContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager

  @SuppressLint("MissingPermission")
  fun generation(isCellular: Boolean): String? {
    if (!isCellular || telephonyManager == null) return null
    if (
      ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_PHONE_STATE) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      return null
    }

    return try {
      Mappers.mapCellularGeneration(telephonyManager.dataNetworkType)
    } catch (_: SecurityException) {
      null
    } catch (_: RuntimeException) {
      null
    }
  }
}
