jest.mock("@/core/control/trackPlayerReadiness", () => ({
    waitForTrackPlayerReady: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/core/control/carMode", () => ({
    runCarMode: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        skipToNext: jest.fn(() => Promise.resolve()),
        skipToPrevious: jest.fn(() => Promise.resolve()),
    },
}));

import TrackPlayer from "@/core/trackPlayer";
import { runCarMode } from "@/core/control/carMode";
import { handleMusicFreeControl } from "../handleMusicFreeControl";
import { waitForTrackPlayerReady } from "@/core/control/trackPlayerReadiness";

const mockedSkipNext = TrackPlayer.skipToNext as jest.MockedFunction<
    typeof TrackPlayer.skipToNext
>;
const mockedSkipPrev = TrackPlayer.skipToPrevious as jest.MockedFunction<
    typeof TrackPlayer.skipToPrevious
>;
const mockedRunCarMode = runCarMode as jest.MockedFunction<typeof runCarMode>;
const mockedWaitReady = waitForTrackPlayerReady as jest.MockedFunction<
    typeof waitForTrackPlayerReady
>;

describe("handleMusicFreeControl", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("waits for track player before handling", async () => {
        await handleMusicFreeControl("next");
        expect(mockedWaitReady).toHaveBeenCalled();
    });

    it("dispatches next to skipToNext", async () => {
        await handleMusicFreeControl("next");
        expect(mockedSkipNext).toHaveBeenCalledTimes(1);
        expect(mockedSkipPrev).not.toHaveBeenCalled();
        expect(mockedRunCarMode).not.toHaveBeenCalled();
    });

    it("dispatches prev to skipToPrevious", async () => {
        await handleMusicFreeControl("prev");
        expect(mockedSkipPrev).toHaveBeenCalledTimes(1);
        expect(mockedSkipNext).not.toHaveBeenCalled();
        expect(mockedRunCarMode).not.toHaveBeenCalled();
    });

    it("dispatches car to runCarMode", async () => {
        await handleMusicFreeControl("car");
        expect(mockedRunCarMode).toHaveBeenCalledTimes(1);
        expect(mockedSkipNext).not.toHaveBeenCalled();
        expect(mockedSkipPrev).not.toHaveBeenCalled();
    });
});
