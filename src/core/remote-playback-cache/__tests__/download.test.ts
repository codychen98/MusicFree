const mockDownloadFile = jest.fn();
const mockExists = jest.fn();
const mockStat = jest.fn();
const mockUnlink = jest.fn();
const mockWriteFile = jest.fn();

const mockGetRemoteDownloadUrl = jest.fn();
const mockFetchRemoteSidecarLyrics = jest.fn();
const mockHasSufficientFreeSpace = jest.fn();

const mockGetCacheEntry = jest.fn();
const mockSetCacheEntry = jest.fn();
const mockEnsureDir = jest.fn();

jest.mock("react-native-fs", () => ({
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
    exists: (...args: unknown[]) => mockExists(...args),
    stat: (...args: unknown[]) => mockStat(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

jest.mock("@/core/remote-storage/playback-client", () => ({
    getRemoteDownloadUrl: (...args: unknown[]) => mockGetRemoteDownloadUrl(...args),
}));

jest.mock("@/core/webdav-download/sidecar", () => ({
    fetchRemoteSidecarLyrics: (...args: unknown[]) =>
        mockFetchRemoteSidecarLyrics(...args),
}));

jest.mock("@/utils/fileUtils", () => ({
    addFileScheme: (p: string) => (p.startsWith("/") ? `file://${p}` : p),
}));

jest.mock("@/utils/log", () => ({ errorLog: jest.fn() }));

jest.mock("../index-store", () => ({
    getCacheEntry: (...args: unknown[]) => mockGetCacheEntry(...args),
    setCacheEntry: (...args: unknown[]) => mockSetCacheEntry(...args),
}));

jest.mock("../paths", () => ({
    ensureRemotePlaybackCacheDir: (...args: unknown[]) => mockEnsureDir(...args),
    localPathForRemote: (p: string) => `/cache/remote-playback/key.mp3`,
    localLrcPathForRemote: (p: string) => `/cache/remote-playback/key.lrc`,
    localTranLrcPathForRemote: (p: string) => `/cache/remote-playback/key.tran.lrc`,
}));

jest.mock("../free-space", () => ({
    hasSufficientFreeSpace: (...args: unknown[]) => mockHasSufficientFreeSpace(...args),
}));

import { cacheRemoteTrack } from "../download";

function resolvedDownload(result: {
    statusCode?: number;
    bytesWritten?: number;
}) {
    mockDownloadFile.mockReturnValue({ promise: Promise.resolve(result) });
}

describe("cacheRemoteTrack", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetCacheEntry.mockReturnValue(null);
        mockHasSufficientFreeSpace.mockResolvedValue(true);
        mockGetRemoteDownloadUrl.mockResolvedValue("https://cdn/song.mp3");
        mockFetchRemoteSidecarLyrics.mockResolvedValue({});
        mockEnsureDir.mockResolvedValue(undefined);
        mockWriteFile.mockResolvedValue(undefined);
        mockUnlink.mockResolvedValue(undefined);
    });

    it("returns invalid-path for blank input", async () => {
        expect(await cacheRemoteTrack("   ")).toEqual({
            cached: false,
            reason: "invalid-path",
        });
        expect(mockDownloadFile).not.toHaveBeenCalled();
    });

    it("skips when a valid cache entry already exists", async () => {
        mockGetCacheEntry.mockReturnValue({
            localPath: "/cache/remote-playback/key.mp3",
        });
        mockExists.mockResolvedValue(true);

        expect(await cacheRemoteTrack("/music/song.mp3")).toEqual({
            cached: false,
            reason: "already-cached",
        });
        expect(mockDownloadFile).not.toHaveBeenCalled();
    });

    it("skips when free space is insufficient", async () => {
        mockHasSufficientFreeSpace.mockResolvedValue(false);

        expect(await cacheRemoteTrack("/music/song.mp3")).toEqual({
            cached: false,
            reason: "low-space",
        });
        expect(mockDownloadFile).not.toHaveBeenCalled();
    });

    it("returns no-url when the download url is empty", async () => {
        mockGetRemoteDownloadUrl.mockResolvedValue("");

        expect(await cacheRemoteTrack("/music/song.mp3")).toEqual({
            cached: false,
            reason: "no-url",
        });
    });

    it("downloads audio and writes an index entry with download byte count", async () => {
        resolvedDownload({ statusCode: 200, bytesWritten: 4096 });

        const result = await cacheRemoteTrack("/music/song.mp3");

        expect(result).toEqual({ cached: true });
        expect(mockDownloadFile).toHaveBeenCalledWith(
            expect.objectContaining({
                fromUrl: "https://cdn/song.mp3",
                toFile: "file:///cache/remote-playback/key.mp3",
            }),
        );
        expect(mockSetCacheEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                remotePath: "/music/song.mp3",
                localPath: "/cache/remote-playback/key.mp3",
                size: 4096,
            }),
        );
        expect(mockStat).not.toHaveBeenCalled();
    });

    it("falls back to stat for size when bytesWritten is missing", async () => {
        resolvedDownload({ statusCode: 200 });
        mockStat.mockResolvedValue({ size: "2048" });

        await cacheRemoteTrack("/music/song.mp3");

        expect(mockSetCacheEntry).toHaveBeenCalledWith(
            expect.objectContaining({ size: 2048 }),
        );
    });

    it("caches sidecar lyrics and records their paths", async () => {
        resolvedDownload({ statusCode: 200, bytesWritten: 10 });
        mockFetchRemoteSidecarLyrics.mockResolvedValue({
            rawLrc: "[00:00]hi",
            translation: "[00:00]hello",
        });

        await cacheRemoteTrack("/music/song.mp3");

        expect(mockWriteFile).toHaveBeenCalledWith(
            "/cache/remote-playback/key.lrc",
            "[00:00]hi",
            "utf8",
        );
        expect(mockWriteFile).toHaveBeenCalledWith(
            "/cache/remote-playback/key.tran.lrc",
            "[00:00]hello",
            "utf8",
        );
        expect(mockSetCacheEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                lrcPath: "/cache/remote-playback/key.lrc",
                tranLrcPath: "/cache/remote-playback/key.tran.lrc",
            }),
        );
    });

    it("cleans up and reports error on an http error status", async () => {
        resolvedDownload({ statusCode: 404, bytesWritten: 0 });

        expect(await cacheRemoteTrack("/music/song.mp3")).toEqual({
            cached: false,
            reason: "error",
        });
        expect(mockUnlink).toHaveBeenCalledWith(
            "file:///cache/remote-playback/key.mp3",
        );
        expect(mockSetCacheEntry).not.toHaveBeenCalled();
    });

    it("reports error when the download throws", async () => {
        mockGetRemoteDownloadUrl.mockRejectedValue(new Error("network"));

        expect(await cacheRemoteTrack("/music/song.mp3")).toEqual({
            cached: false,
            reason: "error",
        });
        expect(mockSetCacheEntry).not.toHaveBeenCalled();
    });
});
