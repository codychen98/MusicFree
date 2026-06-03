import {
    beginTrackPlayerInit,
    markTrackPlayerReady,
    waitForTrackPlayerReady,
} from "../trackPlayerReadiness";

describe("trackPlayerReadiness", () => {
    it("blocks until markTrackPlayerReady after beginTrackPlayerInit", async () => {
        beginTrackPlayerInit();
        let resolved = false;
        const pending = waitForTrackPlayerReady().then(() => {
            resolved = true;
        });
        await Promise.resolve();
        expect(resolved).toBe(false);
        markTrackPlayerReady();
        await pending;
        expect(resolved).toBe(true);
    });
});
