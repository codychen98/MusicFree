package `fun`.upup.musicfree

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object MusicFreeControlEmitter {
    const val EVENT_NAME = "MusicFreeControl"

    fun emit(reactContext: ReactContext, action: String) {
        val params = Arguments.createMap().apply {
            putString("action", action)
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_NAME, params)
    }
}
