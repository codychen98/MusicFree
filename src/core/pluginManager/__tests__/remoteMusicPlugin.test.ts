import type { RemoteDirectoryEntry } from "@/core/remote-storage/types";

const mockGetRemoteMusicClient = jest.fn();
const mockGetRemoteDownloadUrl = jest.fn();
const mockReadRemoteMusicConfigSnapshot = jest.fn();
const mockGetRemoteMusicPath = jest.fn();
const mockGetRemoteStorageCredentialsFromConfig = jest.fn();
const mockResolveRemoteTransport = jest.fn();

jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: {
        getConfig: jest.fn(() => false),
    },
}));

jest.mock("@/core/remote-playback-cache/download", () => ({
    cacheRemoteTrack: jest.fn(),
}));

jest.mock("@/core/remote-playback-cache/lookup", () => ({
    getCachedPlaybackFileUrl: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/core/webdav-download/upload", () => ({
    getRemoteMusicClient: (...args: unknown[]) =>
        mockGetRemoteMusicClient(...args),
}));

jest.mock("@/core/remote-storage/playback-client", () => ({
    getRemoteDownloadUrl: (...args: unknown[]) =>
        mockGetRemoteDownloadUrl(...args),
}));

jest.mock("@/core/webdav-download/config", () => ({
    readRemoteMusicConfigSnapshot: (...args: unknown[]) =>
        mockReadRemoteMusicConfigSnapshot(...args),
}));

jest.mock("@/core/remote-storage/remote-config", () => ({
    REMOTE_MUSIC_PLUGIN_PLATFORM: "WebDAV",
    REMOTE_MUSIC_PLUGIN_HASH: "WebDAV",
    getRemoteMusicPath: (...args: unknown[]) => mockGetRemoteMusicPath(...args),
    getRemoteStorageCredentialsFromConfig: (...args: unknown[]) =>
        mockGetRemoteStorageCredentialsFromConfig(...args),
}));

jest.mock("@/core/remote-storage/resolve", () => ({
    resolveRemoteTransport: (...args: unknown[]) =>
        mockResolveRemoteTransport(...args),
}));

jest.mock("../plugin", () => {
    class Plugin {
        name = "";
        hash = "";
        instance: IPlugin.IPluginDefine = { platform: "" };
        supportedMethods = new Set<string>();
        methods = {};

        constructor(
            define: () => IPlugin.IPluginDefine,
            _path: string,
        ) {
            this.instance = define();
            this.name = this.instance.platform;
            this.supportedMethods = new Set(
                Object.keys(this.instance).filter(
                    key => typeof (this.instance as Record<string, unknown>)[key]
                        === "function",
                ),
            );
        }
    }

    return { Plugin };
});

function audioEntry(
    path: string,
    basename: string,
): RemoteDirectoryEntry {
    return {
        path,
        basename,
        type: "file",
        mime: "audio/mpeg",
    };
}

describe("remoteMusicPlugin", () => {
    let remoteMusicPlugin: typeof import("../remoteMusicPlugin").default;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        mockReadRemoteMusicConfigSnapshot.mockReturnValue({});
        mockGetRemoteMusicPath.mockReturnValue("/Music/Download");
        mockGetRemoteStorageCredentialsFromConfig.mockReturnValue({
            webdav: {
                url: "https://dav.example",
                rootPath: "",
                username: "user",
                password: "pass",
            },
        });
        mockResolveRemoteTransport.mockReturnValue("webdav");
        remoteMusicPlugin = require("../remoteMusicPlugin").default;
    });

    it("exposes built-in WebDAV platform and hash", () => {
        expect(remoteMusicPlugin.name).toBe("WebDAV");
        expect(remoteMusicPlugin.hash).toBe("WebDAV");
        expect(remoteMusicPlugin.instance.supportedSearchType).toEqual(["music"]);
    });

    it("searches cached audio files by basename", async () => {
        const client = {
            listDirectory: jest.fn().mockResolvedValue([
                audioEntry("/Music/Download/song.mp3", "song.mp3"),
                audioEntry("/Music/Download/other.flac", "other.flac"),
            ]),
        };
        mockGetRemoteMusicClient.mockResolvedValue(client);

        const result = await remoteMusicPlugin.instance.search!("song", 1, "music");

        expect(result.isEnd).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data?.[0]).toMatchObject({
            platform: "WebDAV",
            id: "/Music/Download/song.mp3",
            title: "song",
            artist: "未知作者",
        });
    });

    it("parses title@artist basenames", async () => {
        const client = {
            listDirectory: jest.fn().mockResolvedValue([
                audioEntry(
                    "/Music/Download/最后一页@江语晨.mp3",
                    "最后一页@江语晨.mp3",
                ),
            ]),
        };
        mockGetRemoteMusicClient.mockResolvedValue(client);

        const result = await remoteMusicPlugin.instance.search!("", 1, "music");

        expect(result.data?.[0]).toMatchObject({
            title: "最后一页",
            artist: "江语晨",
        });
    });

    it("returns top list groups for configured musicPath segments", async () => {
        mockGetRemoteMusicPath.mockReturnValue("/A,/B");
        mockGetRemoteMusicClient.mockResolvedValue({
            listDirectory: jest.fn(),
        });

        const groups = await remoteMusicPlugin.instance.getTopLists!();

        expect(groups).toEqual([
            {
                title: "全部歌曲",
                data: [
                    { platform: "WebDAV", title: "/A", id: "/A" },
                    { platform: "WebDAV", title: "/B", id: "/B" },
                ],
            },
        ]);
    });

    it("lists audio files in getTopListDetail", async () => {
        const client = {
            listDirectory: jest.fn().mockResolvedValue([
                audioEntry("/Music/Download/a.mp3", "a.mp3"),
                {
                    path: "/Music/Download/readme.txt",
                    basename: "readme.txt",
                    type: "file",
                },
            ]),
        };
        mockGetRemoteMusicClient.mockResolvedValue(client);

        const detail = await remoteMusicPlugin.instance.getTopListDetail!({
            platform: "WebDAV",
            id: "/Music/Download",
            title: "/Music/Download",
        });

        expect(client.listDirectory).toHaveBeenCalledWith("/Music/Download");
        expect(detail.musicList).toHaveLength(1);
        expect(detail.musicList?.[0]?.id).toBe("/Music/Download/a.mp3");
    });

    it("resolves media source via playback client", async () => {
        mockGetRemoteDownloadUrl.mockResolvedValue("https://cdn.example/song.mp3");

        const source = await remoteMusicPlugin.instance.getMediaSource!({
            platform: "WebDAV",
            id: "/Music/Download/song.mp3",
            title: "song",
            artist: "artist",
        });

        expect(mockGetRemoteDownloadUrl).toHaveBeenCalledWith(
            "/Music/Download/song.mp3",
        );
        expect(source).toEqual({ url: "https://cdn.example/song.mp3" });
    });
});
