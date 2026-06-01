package `fun`.upup.musicfree
import android.content.res.Configuration
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactContext
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import `fun`.upup.musicfree.lyricUtil.LyricUtilPackage
import `fun`.upup.musicfree.mp3Util.Mp3UtilPackage
import `fun`.upup.musicfree.utils.UtilsPackage

class MainApplication : Application(), ReactApplication {

  private var controlContextListener: ReactInstanceEventListener? = null

  override val reactNativeHost: ReactNativeHost =
      ReactNativeHostWrapper(this, object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
              add(UtilsPackage())
              add(Mp3UtilPackage())
              add(LyricUtilPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      })

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  /**
   * Loads the React instance without starting MainActivity (MacroDroid car/next/prev).
   * v1: first use after reboot may require the JS bundle to finish bootstrap before controls work.
   */
  fun ensureReactContextForControl() {
    val manager = reactNativeHost.reactInstanceManager
    val existing: ReactContext? = manager.currentReactContext
    if (existing != null) {
      MusicFreeControlPendingQueue.flush(existing)
      return
    }
    if (controlContextListener == null) {
      val listener = ReactInstanceEventListener { context: ReactContext ->
        MusicFreeControlPendingQueue.flush(context)
        manager.removeReactInstanceEventListener(listener)
        controlContextListener = null
      }
      controlContextListener = listener
      manager.addReactInstanceEventListener(listener)
    }
    if (!manager.hasStartedCreatingInitialContext()) {
      manager.createReactContextInBackground()
    }
  }
}
