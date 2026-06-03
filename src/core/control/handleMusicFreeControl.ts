import TrackPlayer from "@/core/trackPlayer";
import { runCarMode } from "@/core/control/carMode";
import { favoriteCurrentTrack } from "@/core/control/favoriteCurrentTrack";
import { waitForTrackPlayerReady } from "@/core/control/trackPlayerReadiness";

export type MusicFreeControlAction = "car" | "next" | "prev" | "favorite";

export async function handleMusicFreeControl(
    action: MusicFreeControlAction,
): Promise<void> {
    await waitForTrackPlayerReady();

    if (action === "next") {
        await TrackPlayer.skipToNext();
        return;
    }
    if (action === "prev") {
        await TrackPlayer.skipToPrevious();
        return;
    }
    if (action === "favorite") {
        await favoriteCurrentTrack();
        return;
    }
    await runCarMode();
}
