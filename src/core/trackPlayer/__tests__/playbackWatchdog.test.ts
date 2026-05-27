import {
    isNearEndOfTrack,
    shouldSkipPlaybackEndedFallback,
    shouldTriggerEofWatchdog,
    shouldTriggerSentinelStuckWatchdog,
} from "../playbackWatchdog";
const fakeUrl = "android.resource://fun.upup.musicfree/raw/silent_1s";
const proposedUrl = "musicfree://proposed-audio";
const isSentinelUrl = (url?: string) => url === fakeUrl;

describe("isNearEndOfTrack", () => {
    it("detects normal track near EOF", () => {
        expect(isNearEndOfTrack(156, 157)).toBe(true);
        expect(isNearEndOfTrack(150, 157)).toBe(false);
    });

    it("detects corrupt 1s duration at end", () => {
        expect(isNearEndOfTrack(1, 1)).toBe(true);
        expect(isNearEndOfTrack(0.5, 1)).toBe(false);
    });
});

describe("shouldTriggerEofWatchdog", () => {
    const base = {
        activeIndex: 0,
        state: "loading" as const,
        position: 156,
        duration: 157,
        playListLength: 2,
        nearEndSince: 1000,
        positionStallSince: null,
        now: 3500,
    };

    it("fires after sustained near-end in Loading", () => {
        expect(shouldTriggerEofWatchdog(base)).toBe(true);
    });

    it("does not fire when user paused near end", () => {
        expect(
            shouldTriggerEofWatchdog({ ...base, state: "paused" }),
        ).toBe(false);
    });

    it("does not fire before dwell time", () => {
        expect(
            shouldTriggerEofWatchdog({
                ...base,
                now: 2500,
            }),
        ).toBe(false);
    });

    it("fires on position stall while Playing near EOF", () => {
        expect(
            shouldTriggerEofWatchdog({
                ...base,
                state: "playing",
                nearEndSince: null,
                positionStallSince: 500,
                now: 4000,
            }),
        ).toBe(true);
    });
});

describe("shouldTriggerSentinelStuckWatchdog", () => {
    it("fires when sentinel stuck loading", () => {
        expect(
            shouldTriggerSentinelStuckWatchdog({
                activeIndex: 1,
                activeUrl: fakeUrl,
                state: "loading",
                isSentinelUrl,
                stuckSince: 1000,
                now: 5000,
            }),
        ).toBe(true);
    });

    it("does not fire when sentinel is playing", () => {
        expect(
            shouldTriggerSentinelStuckWatchdog({
                activeIndex: 1,
                activeUrl: fakeUrl,
                state: "playing",
                isSentinelUrl,
                stuckSince: 1000,
                now: 5000,
            }),
        ).toBe(false);
    });
});

describe("shouldSkipPlaybackEndedFallback", () => {
    it("never skips sentinel reason", () => {
        expect(
            shouldSkipPlaybackEndedFallback({
                reason: "sentinel",
                activeUrl: fakeUrl,
                activeIndex: 1,
                state: "playing",
                proposedAudioUrl: proposedUrl,
                isSentinelUrl,
            }),
        ).toBe(false);
    });

    it("skips proposed placeholder during play()", () => {
        expect(
            shouldSkipPlaybackEndedFallback({
                reason: "PlaybackQueueEnded",
                activeUrl: proposedUrl,
                activeIndex: 0,
                state: "loading",
                proposedAudioUrl: proposedUrl,
                isSentinelUrl,
            }),
        ).toBe(true);
    });

    it("skips when sentinel is playing normally", () => {
        expect(
            shouldSkipPlaybackEndedFallback({
                reason: "PlaybackState:Ended",
                activeUrl: fakeUrl,
                activeIndex: 1,
                state: "playing",
                proposedAudioUrl: proposedUrl,
                isSentinelUrl,
            }),
        ).toBe(true);
    });

    it("allows fallback when sentinel stuck loading", () => {
        expect(
            shouldSkipPlaybackEndedFallback({
                reason: "watchdog:sentinelStuck",
                activeUrl: fakeUrl,
                activeIndex: 1,
                state: "loading",
                proposedAudioUrl: proposedUrl,
                isSentinelUrl,
            }),
        ).toBe(false);
    });
});
