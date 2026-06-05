import { ImgAsset } from "@/constants/assetsConst";
import Config from "@/core/appConfig";
import RNTrackPlayer, {
    AppKilledPlaybackBehavior,
    Capability,
} from "react-native-track-player";

/**
 * Applies the player notification options AND, critically, the
 * progressUpdateEventInterval that makes PlaybackProgressUpdated fire.
 *
 * This must run after EVERY setupPlayer() call — including the lazy
 * "player is not initialized" recovery in TrackPlayer.play(). When the OS kills
 * the playback service in the background and the player is later re-created via a
 * bare setupPlayer(), skipping this leaves the new player with no progress-update
 * interval, so PlaybackProgressUpdated never fires and every progress-driven
 * feature (notably lyric line sync, which advances currentLyricItem on each tick)
 * freezes on the first line until a full restart.
 */
export async function configureTrackPlayerOptions(): Promise<void> {
    const capabilities = Config.getConfig("basic.showExitOnNotification")
        ? [
            Capability.SkipToPrevious,
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.Stop,
        ]
        : [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
        ];

    await RNTrackPlayer.updateOptions({
        icon: ImgAsset.logoTransparent,
        stopIcon: ImgAsset.notificationExit,
        progressUpdateEventInterval: 1,
        android: {
            alwaysPauseOnInterruption: true,
            appKilledPlaybackBehavior:
                AppKilledPlaybackBehavior.ContinuePlayback,
        },
        capabilities: capabilities,
        compactCapabilities: capabilities,
        // Omit SeekTo here: it was appended after Stop and showed as a second
        // square that often matched Stop behavior. Scrubbing still uses RemoteSeek.
        notificationCapabilities: capabilities,
    });
}
