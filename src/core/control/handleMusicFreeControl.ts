import TrackPlayer from "@/core/trackPlayer";
import { runCarMode } from "@/core/control/carMode";
import { waitForTrackPlayerReady } from "@/core/control/trackPlayerReadiness";

export type MusicFreeControlAction = "car" | "next" | "prev";

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
    await runCarMode();
}
