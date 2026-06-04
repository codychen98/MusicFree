import Config from "@/core/appConfig";
import lyricManager from "@/core/lyricManager";
import RNTrackPlayer, { Event, State } from "react-native-track-player";
import TrackPlayer from "@/core/trackPlayer";
import NativeUtils from "@/native/utils";
import { musicIsPaused } from "@/utils/trackUtils";
import PersistStatus from "@/utils/persistStatus";

let resumeState: State | null;
module.exports = async function () {
    TrackPlayer.registerPlaybackServiceHandlers();

    RNTrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
    RNTrackPlayer.addEventListener(Event.RemotePause, () =>
        TrackPlayer.pause(),
    );
    RNTrackPlayer.addEventListener(Event.RemotePrevious, () =>
        TrackPlayer.skipToPrevious(),
    );
    RNTrackPlayer.addEventListener(Event.RemoteNext, () =>
        TrackPlayer.skipToNext(),
    );
    RNTrackPlayer.addEventListener(
        Event.RemoteDuck,
        async ({ paused, permanent }) => {
            if (Config.getConfig("basic.notInterrupt")) {
                return;
            }
            if (permanent) {
                return TrackPlayer.pause();
            }
            const tempRemoteDuckConf = Config.getConfig(
                "basic.tempRemoteDuck",
            );
            if (tempRemoteDuckConf === "lowerVolume") {
                if (paused) {
                    const tempRemoteDuckVolume = Config.getConfig(
                        "basic.tempRemoteDuckVolume",
                    ) ?? 0.5;
                    return RNTrackPlayer.setVolume(1 - tempRemoteDuckVolume);
                } else {
                    return RNTrackPlayer.setVolume(1);
                }
            } else {
                if (paused) {
                    resumeState =
                        (await RNTrackPlayer.getPlaybackState()).state ??
                        State.Paused;
                    return TrackPlayer.pause();
                } else {
                    if (resumeState && !musicIsPaused(resumeState)) {
                        resumeState = null;
                        return TrackPlayer.play();
                    }
                    resumeState = null;
                }
            }
        },
    );


    RNTrackPlayer.addEventListener(Event.PlaybackProgressUpdated, evt => {
        PersistStatus.set("music.progress", evt.position);
        TrackPlayer.tickPlaybackWatchdog({
            position: evt.position,
            duration: evt.duration,
        });
        // Playback service keeps running in background; recover desktop lyrics here.
        lyricManager.tickLyricRecoveryWatchdog(evt.position);
    });

    RNTrackPlayer.addEventListener(Event.RemoteStop, async () => {
        if (Config.getConfig("basic.showExitOnNotification")) {
            await TrackPlayer.reset();
            NativeUtils.exitApp();
            return;
        }
        RNTrackPlayer.stop();
    });

    RNTrackPlayer.addEventListener(Event.RemoteSeek, async evt => {
        TrackPlayer.seekTo(evt.position);
    });
};
