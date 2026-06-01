package `fun`.upup.musicfree

import com.facebook.react.bridge.ReactContext

object MusicFreeControlPendingQueue {
    private val pending = mutableListOf<String>()

    @Synchronized
    fun enqueue(action: String) {
        pending.add(action)
    }

    @Synchronized
    fun flush(reactContext: ReactContext) {
        val actions = pending.toList()
        pending.clear()
        for (action in actions) {
            MusicFreeControlEmitter.emit(reactContext, action)
        }
    }
}
