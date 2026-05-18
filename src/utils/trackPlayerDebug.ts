import { trace } from "@/utils/log";
import ReactNativeTrackPlayer, { Track } from "react-native-track-player";

type QueueTrackSummary = {
    index: number;
    url?: string;
    internalKey?: string;
    id?: string;
    title?: string;
};

function summarizeQueueTrack(track: Track | undefined, index: number): QueueTrackSummary {
    if (!track) {
        return { index };
    }
    const extended = track as Track & { $?: string; id?: string; title?: string };
    return {
        index,
        url: track.url,
        internalKey: extended.$,
        id: extended.id,
        title: extended.title,
    };
}

export async function logQueueSnapshot(
    tag: string,
    extra?: Record<string, unknown>,
): Promise<void> {
    try {
        const [queue, activeIndex, playbackState, progress] = await Promise.all([
            ReactNativeTrackPlayer.getQueue(),
            ReactNativeTrackPlayer.getActiveTrackIndex(),
            ReactNativeTrackPlayer.getPlaybackState(),
            ReactNativeTrackPlayer.getProgress(),
        ]);

        const payload = {
            tag,
            queueLength: queue.length,
            queue: queue.map((track, index) => summarizeQueueTrack(track, index)),
            activeIndex,
            state: playbackState.state,
            position: progress.position,
            duration: progress.duration,
            ...extra,
        };

        trace(tag, JSON.stringify(payload));
    } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        trace(
            tag,
            JSON.stringify({
                tag,
                snapshotError: errorMessage,
                ...extra,
            }),
        );
    }
}
