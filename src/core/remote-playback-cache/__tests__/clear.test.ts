const mockExists = jest.fn();
const mockUnlink = jest.fn();

const mockClearCacheIndex = jest.fn();
const mockGetCacheEntry = jest.fn();
const mockRemoveCacheEntry = jest.fn();

jest.mock("react-native-fs", () => ({
    exists: (...args: unknown[]) => mockExists(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
}));

jest.mock("@/utils/log", () => ({ errorLog: jest.fn() }));

jest.mock("../index-store", () => ({
    clearCacheIndex: (...args: unknown[]) => mockClearCacheIndex(...args),
    getCacheEntry: (...args: unknown[]) => mockGetCacheEntry(...args),
    removeCacheEntry: (...args: unknown[]) => mockRemoveCacheEntry(...args),
}));

jest.mock("../paths", () => ({
    remotePlaybackCacheDir: "/cache/remote-playback/",
}));

import { clearRemotePlaybackCache, removeCachedTrack } from "../clear";

describe("clearRemotePlaybackCache", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUnlink.mockResolvedValue(undefined);
    });

    it("deletes the cache dir and clears the index", async () => {
        mockExists.mockResolvedValue(true);

        await clearRemotePlaybackCache();

        expect(mockUnlink).toHaveBeenCalledWith("/cache/remote-playback/");
        expect(mockClearCacheIndex).toHaveBeenCalled();
    });

    it("still clears the index when the dir is absent", async () => {
        mockExists.mockResolvedValue(false);

        await clearRemotePlaybackCache();

        expect(mockUnlink).not.toHaveBeenCalled();
        expect(mockClearCacheIndex).toHaveBeenCalled();
    });

    it("clears the index even when directory deletion fails", async () => {
        mockExists.mockResolvedValue(true);
        mockUnlink.mockRejectedValue(new Error("permission"));

        await clearRemotePlaybackCache();

        expect(mockClearCacheIndex).toHaveBeenCalled();
    });
});

describe("removeCachedTrack", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUnlink.mockResolvedValue(undefined);
        mockExists.mockResolvedValue(true);
    });

    it("ignores blank input", async () => {
        await removeCachedTrack("   ");
        expect(mockRemoveCacheEntry).not.toHaveBeenCalled();
    });

    it("removes the audio file, sidecars, and index entry", async () => {
        mockGetCacheEntry.mockReturnValue({
            localPath: "/cache/remote-playback/key.mp3",
            lrcPath: "/cache/remote-playback/key.lrc",
            tranLrcPath: "/cache/remote-playback/key.tran.lrc",
        });

        await removeCachedTrack("/music/song.mp3");

        expect(mockUnlink).toHaveBeenCalledWith("/cache/remote-playback/key.mp3");
        expect(mockUnlink).toHaveBeenCalledWith("/cache/remote-playback/key.lrc");
        expect(mockUnlink).toHaveBeenCalledWith(
            "/cache/remote-playback/key.tran.lrc",
        );
        expect(mockRemoveCacheEntry).toHaveBeenCalledWith("/music/song.mp3");
    });

    it("still removes the index entry when no entry files are recorded", async () => {
        mockGetCacheEntry.mockReturnValue(null);

        await removeCachedTrack("/music/song.mp3");

        expect(mockUnlink).not.toHaveBeenCalled();
        expect(mockRemoveCacheEntry).toHaveBeenCalledWith("/music/song.mp3");
    });
});
