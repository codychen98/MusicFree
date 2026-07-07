jest.mock("@/utils/getOrCreateMMKV", () => {
    const data = new Map<string, string>();
    const store = {
        getString: (key: string) => data.get(key),
        set: (key: string, value: string) => {
            data.set(key, value);
        },
        delete: (key: string) => {
            data.delete(key);
        },
        getAllKeys: () => [...data.keys()],
        clearAll: () => {
            data.clear();
        },
    };
    return { __esModule: true, default: () => store };
});

import {
    clearCacheIndex,
    getCacheEntry,
    getTotalCachedSize,
    listCacheEntries,
    removeCacheEntry,
    setCacheEntry,
    touchCacheEntry,
    type RemotePlaybackCacheEntry,
} from "../index-store";

function entry(
    overrides: Partial<RemotePlaybackCacheEntry> = {},
): RemotePlaybackCacheEntry {
    return {
        remotePath: "/music/song.mp3",
        localPath: "/cache/remote-playback/abc.mp3",
        size: 100,
        cachedAt: 1000,
        lastPlayedAt: 1000,
        ...overrides,
    };
}

describe("remote-playback-cache index-store", () => {
    beforeEach(() => {
        clearCacheIndex();
        jest.restoreAllMocks();
    });

    it("round-trips an entry", () => {
        setCacheEntry(entry());
        expect(getCacheEntry("/music/song.mp3")).toMatchObject({
            remotePath: "/music/song.mp3",
            localPath: "/cache/remote-playback/abc.mp3",
            size: 100,
        });
    });

    it("trims the remote path key on read and write", () => {
        setCacheEntry(entry({ remotePath: "  /music/song.mp3  " }));
        expect(getCacheEntry("/music/song.mp3")).not.toBeNull();
    });

    it("returns null for missing or blank keys", () => {
        expect(getCacheEntry("/nope.mp3")).toBeNull();
        expect(getCacheEntry("   ")).toBeNull();
    });

    it("removes an entry", () => {
        setCacheEntry(entry());
        removeCacheEntry("/music/song.mp3");
        expect(getCacheEntry("/music/song.mp3")).toBeNull();
    });

    it("touch bumps lastPlayedAt only for existing entries", () => {
        setCacheEntry(entry({ lastPlayedAt: 1000 }));
        jest.spyOn(Date, "now").mockReturnValue(5000);
        touchCacheEntry("/music/song.mp3");
        expect(getCacheEntry("/music/song.mp3")?.lastPlayedAt).toBe(5000);

        touchCacheEntry("/music/absent.mp3");
        expect(getCacheEntry("/music/absent.mp3")).toBeNull();
    });

    it("lists entries and sums total cached size", () => {
        setCacheEntry(entry({ remotePath: "/a.mp3", size: 100 }));
        setCacheEntry(entry({ remotePath: "/b.mp3", size: 250 }));
        expect(listCacheEntries()).toHaveLength(2);
        expect(getTotalCachedSize()).toBe(350);
    });

    it("clears the whole index", () => {
        setCacheEntry(entry({ remotePath: "/a.mp3" }));
        setCacheEntry(entry({ remotePath: "/b.mp3" }));
        clearCacheIndex();
        expect(listCacheEntries()).toHaveLength(0);
        expect(getTotalCachedSize()).toBe(0);
    });
});
