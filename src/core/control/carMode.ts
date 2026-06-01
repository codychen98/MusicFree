import Config from "@/core/appConfig";
import i18n from "@/core/i18n";
import lyricManager from "@/core/lyricManager";
import MusicSheet from "@/core/musicSheet";
import TrackPlayer from "@/core/trackPlayer";
import { MusicRepeatMode } from "@/constants/repeatModeConst";
import LyricUtil from "@/native/lyricUtil";
import Toast from "@/utils/toast";

const FAVORITE_SHEET_ID = "favorite";

export async function runCarMode(): Promise<void> {
    const musicList =
        MusicSheet.getSortedMusicListBySheetId(FAVORITE_SHEET_ID).musicList;

    if (!musicList.length) {
        Toast.warn(i18n.t("toast.carMode.emptyFavorites"));
        return;
    }

    let track = musicList[0];
    if (TrackPlayer.repeatMode === MusicRepeatMode.SHUFFLE) {
        track = musicList[Math.floor(Math.random() * musicList.length)];
    }

    await TrackPlayer.playWithReplacePlayList(track, musicList);

    const hasPermission = await LyricUtil.checkSystemAlertPermission();
    if (hasPermission) {
        await LyricUtil.showStatusBarLyric(
            "MusicFree",
            lyricManager.getDesktopLyricOverlayOptions(),
        );
        Config.setConfig("lyric.showStatusBarLyric", true);
        lyricManager.refreshDesktopLyricOverlay();
    } else {
        Toast.warn(i18n.t("toast.carMode.overlayPermissionDenied"));
    }
}
