import Config from "@/core/appConfig";
import LyricUtil from "@/native/lyricUtil";

/**
 * Applies `lyric.resetDesktopLyricOnStartup` during process bootstrap only.
 * Hides the native overlay and clears the persisted show flag before lyricManager.setup().
 */
export async function applyResetDesktopLyricOnStartup(): Promise<void> {
    if (!Config.getConfig("lyric.resetDesktopLyricOnStartup")) {
        return;
    }
    try {
        await LyricUtil.hideStatusBarLyric();
    } catch {
        // Overlay may not be visible; still clear config.
    }
    Config.setConfig("lyric.showStatusBarLyric", false);
}
