const mockReplaceEverywhere = jest.fn(() => Promise.resolve(1));
const mockSetHistory = jest.fn(() => Promise.resolve());
const mockReplaceMatchingMusic = jest.fn();
const mockIsLocalMusic = jest.fn(() => false);
const mockGetMusicList = jest.fn(() => []);
const mockRemoveMusic = jest.fn(() => Promise.resolve());
const mockMarkMutation = jest.fn();
const mockPatchMediaExtra = jest.fn();
const mockRemoveMediaExtra = jest.fn();

jest.mock("@/constants/commonConst", () => ({
    internalSerializeKey: "$",
    localPluginPlatform: "本地",
}));

jest.mock("@/core/webdav-download/config", () => ({
    WEBDAV_MUSIC_PLUGIN_PLATFORM: "WebDAV",
}));

jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: {
        replaceMatchingMusicEverywhere: (...args: unknown[]) =>
            mockReplaceEverywhere(...args),
    },
}));

jest.mock("@/core/musicHistory", () => ({
    __esModule: true,
    default: {
        history: [],
        setHistory: (...args: unknown[]) => mockSetHistory(...args),
    },
}));

jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        playList: [],
        replaceMatchingMusic: (...args: unknown[]) =>
            mockReplaceMatchingMusic(...args),
    },
}));

jest.mock("@/core/localMusicSheet", () => ({
    __esModule: true,
    default: {
        isLocalMusic: (...args: unknown[]) => mockIsLocalMusic(...args),
        getMusicList: (...args: unknown[]) => mockGetMusicList(...args),
        removeMusic: (...args: unknown[]) => mockRemoveMusic(...args),
    },
}));

jest.mock("@/core/webdav-sync/bridge", () => ({
    markWebdavLocalMutation: (...args: unknown[]) => mockMarkMutation(...args),
}));

jest.mock("@/utils/mediaExtra", () => ({
    patchMediaExtra: (...args: unknown[]) => mockPatchMediaExtra(...args),
    removeMediaExtra: (...args: unknown[]) => mockRemoveMediaExtra(...args),
}));

import { migrateTrackToWebdavSource } from "../migrateTrackToWebdavSource";

describe("migrateTrackToWebdavSource media extras", () => {
    const oldItem = {
        platform: "网易云",
        id: "plugin-track-1",
        title: "Song",
        artist: "Artist",
        album: "Album",
        duration: 120,
    } as IMusic.IMusicItem;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReplaceEverywhere.mockResolvedValue(1);
        mockIsLocalMusic.mockReturnValue(false);
        mockGetMusicList.mockReturnValue([]);
    });

    it("clears extras on the original plugin item and marks only the WebDAV item downloaded", async () => {
        const result = await migrateTrackToWebdavSource(oldItem, {
            remotePath: "/music/Song@Artist.flac",
            title: "Song",
            artist: "Artist",
            album: "Album",
            duration: 120,
        });

        expect(mockRemoveMediaExtra).toHaveBeenCalledWith(oldItem);
        expect(mockPatchMediaExtra).toHaveBeenCalledTimes(1);
        expect(mockPatchMediaExtra).toHaveBeenCalledWith(result.newItem, {
            downloaded: true,
            localPath: undefined,
        });
        expect(result.newItem.platform).toBe("WebDAV");
        expect(result.newItem.id).toBe("/music/Song@Artist.flac");
        expect(mockPatchMediaExtra).not.toHaveBeenCalledWith(
            oldItem,
            expect.anything(),
        );
    });
});
