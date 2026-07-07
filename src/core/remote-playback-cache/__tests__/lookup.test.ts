const mockExists = jest.fn();
const mockGetCacheEntry = jest.fn();
const mockRemoveCacheEntry = jest.fn();
const mockTouchCacheEntry = jest.fn();

jest.mock("react-native-fs", () => ({
    exists: (...args: unknown[]) => mockExists(...args),
}));

jest.mock("../index-store", () => ({
    getCacheEntry: (...args: unknown[]) => mockGetCacheEntry(...args),
    removeCacheEntry: (...args: unknown[]) => mockRemoveCacheEntry(...args),
    touchCacheEntry: (...args: unknown[]) => mockTouchCacheEntry(...args),
}));

import { getCachedPlaybackFileUrl } from "../lookup";

describe("getCachedPlaybackFileUrl", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns a file:// url and touches the entry on a hit", async () => {
        mockGetCacheEntry.mockReturnValue({
            localPath: "/cache/remote-playback/abc.mp3",
        });
        mockExists.mockResolvedValue(true);

        const url = await getCachedPlaybackFileUrl("/music/song.mp3");

        expect(url).toBe("file:///cache/remote-playback/abc.mp3");
        expect(mockTouchCacheEntry).toHaveBeenCalledWith("/music/song.mp3");
        expect(mockRemoveCacheEntry).not.toHaveBeenCalled();
    });

    it("returns null and does not touch when no entry exists", async () => {
        mockGetCacheEntry.mockReturnValue(null);

        expect(await getCachedPlaybackFileUrl("/music/song.mp3")).toBeNull();
        expect(mockExists).not.toHaveBeenCalled();
        expect(mockTouchCacheEntry).not.toHaveBeenCalled();
    });

    it("self-heals a stale row when the file is gone", async () => {
        mockGetCacheEntry.mockReturnValue({
            localPath: "/cache/remote-playback/abc.mp3",
        });
        mockExists.mockResolvedValue(false);

        expect(await getCachedPlaybackFileUrl("/music/song.mp3")).toBeNull();
        expect(mockRemoveCacheEntry).toHaveBeenCalledWith("/music/song.mp3");
        expect(mockTouchCacheEntry).not.toHaveBeenCalled();
    });

    it("returns null for blank input", async () => {
        expect(await getCachedPlaybackFileUrl("   ")).toBeNull();
        expect(mockGetCacheEntry).not.toHaveBeenCalled();
    });
});
