const NEAR_END_EPSILON_SEC = 1.5;
const CORRUPT_DURATION_MAX_SEC = 2;
const EOF_STUCK_MS = 2000;
const SENTINEL_STUCK_MS = 3000;
const POSITION_STALL_MS = 3000;

export function isSentinelPlaybackUrl(
    url: string | undefined,
    isSentinelUrl: (url?: string) => boolean,
): boolean {
    return isSentinelUrl(url);
}

/** True when progress indicates the active track has reached (or passed) its end. */
export function isNearEndOfTrack(position: number, duration: number): boolean {
    if (duration <= 0) {
        return false;
    }
    if (duration <= CORRUPT_DURATION_MAX_SEC) {
        return position >= duration - 0.05;
    }
    return position >= duration - NEAR_END_EPSILON_SEC;
}

/** RNTP `State` string values (avoid importing RNTP in pure helpers for Jest). */
export type PlaybackStateString =
    | "none"
    | "ready"
    | "playing"
    | "paused"
    | "stopped"
    | "loading"
    | "buffering"
    | "error"
    | "ended";

export function isStuckPlaybackStateAtEof(
    state: PlaybackStateString | undefined,
): boolean {
    return (
        state === "loading" ||
        state === "buffering" ||
        state === "ended" ||
        state === "stopped" ||
        state === "ready"
    );
}

export type EofWatchdogInput = {
    activeIndex: number | undefined;
    state: PlaybackStateString | undefined;
    position: number;
    duration: number;
    playListLength: number;
    nearEndSince: number | null;
    positionStallSince: number | null;
    now: number;
};

/** Detect index-0 EOF stall when RNTP never emits Ended / QueueEnded (WebDAV, streams). */
export function shouldTriggerEofWatchdog(input: EofWatchdogInput): boolean {
    if (input.playListLength === 0 || input.activeIndex !== 0) {
        return false;
    }
    if (input.state === "paused") {
        return false;
    }
    if (!isNearEndOfTrack(input.position, input.duration)) {
        return false;
    }

    if (
        isStuckPlaybackStateAtEof(input.state) &&
        input.nearEndSince !== null &&
        input.now - input.nearEndSince >= EOF_STUCK_MS
    ) {
        return true;
    }

    if (
        input.state === "playing" &&
        input.positionStallSince !== null &&
        input.now - input.positionStallSince >= POSITION_STALL_MS
    ) {
        return true;
    }

    return false;
}

export type SentinelStuckWatchdogInput = {
    activeIndex: number | undefined;
    activeUrl: string | undefined;
    state: PlaybackStateString | undefined;
    isSentinelUrl: (url?: string) => boolean;
    stuckSince: number | null;
    now: number;
};

/** Detect sentinel track stuck in Loading/Buffering so EOF fallback is not blocked forever. */
export function shouldTriggerSentinelStuckWatchdog(
    input: SentinelStuckWatchdogInput,
): boolean {
    if (input.activeIndex !== 1) {
        return false;
    }
    if (!isSentinelPlaybackUrl(input.activeUrl, input.isSentinelUrl)) {
        return false;
    }
    if (input.state !== "loading" && input.state !== "buffering") {
        return false;
    }
    if (input.stuckSince === null) {
        return false;
    }
    return input.now - input.stuckSince >= SENTINEL_STUCK_MS;
}

export type PlaybackEndedFallbackSkipInput = {
    reason: string;
    activeUrl: string | undefined;
    activeIndex: number | undefined;
    state: PlaybackStateString | undefined;
    proposedAudioUrl: string;
    isSentinelUrl: (url?: string) => boolean;
};

/**
 * When true, handlePlaybackEnded should not run (sentinel path or play() source fetch owns advance).
 * When stuck on sentinel Loading, returns false so watchdog / queue-ended can advance.
 */
export function shouldSkipPlaybackEndedFallback(
    input: PlaybackEndedFallbackSkipInput,
): boolean {
    if (input.reason === "sentinel") {
        return false;
    }

    const onSentinel = input.isSentinelUrl(input.activeUrl);
    const onProposed = input.activeUrl === input.proposedAudioUrl;

    if (!onSentinel && !onProposed) {
        return false;
    }

    if (onProposed) {
        return true;
    }

    if (
        input.activeIndex === 1 &&
        onSentinel &&
        input.state === "playing"
    ) {
        return true;
    }

    return false;
}

export const playbackWatchdogTiming = {
    intervalMs: 2000,
    eofStuckMs: EOF_STUCK_MS,
    sentinelStuckMs: SENTINEL_STUCK_MS,
    positionStallMs: POSITION_STALL_MS,
} as const;
