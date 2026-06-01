package `fun`.upup.musicfree

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class MusicFreeControlReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = mapAction(intent?.action) ?: return
        val app = context.applicationContext as MainApplication
        val reactContext = app.reactNativeHost.reactInstanceManager.currentReactContext
        if (reactContext != null) {
            MusicFreeControlEmitter.emit(reactContext, action)
            return
        }
        MusicFreeControlPendingQueue.enqueue(action)
        app.ensureReactContextForControl()
    }

    private fun mapAction(intentAction: String?): String? {
        return when (intentAction) {
            ACTION_CAR -> "car"
            ACTION_NEXT -> "next"
            ACTION_PREV -> "prev"
            else -> null
        }
    }

    companion object {
        const val ACTION_CAR = "fun.upup.musicfree.action.CAR"
        const val ACTION_NEXT = "fun.upup.musicfree.action.NEXT"
        const val ACTION_PREV = "fun.upup.musicfree.action.PREV"
    }
}
