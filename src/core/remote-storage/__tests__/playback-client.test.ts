import {
    getRemoteDownloadUrl,
    getRemoteTextForPlayback,
    remoteExistsForPlayback,
} from "../playback-client";
import { RemoteMusicConfigIncompleteError } from "@/core/webdav-download/types";

const mockGetRemoteMusicClient = jest.fn();
const mockCreateWebdavRemoteStorageClient = jest.fn();
const mockShouldUseWebdavPlaybackFallback = jest.fn();
const mockIsWebdavCredentialsCompleteInConfig = jest.fn();
const mockGetRemoteStorageCredentialsFromConfig = jest.fn();

jest.mock("@/core/webdav-download/upload", () => ({
    getRemoteMusicClient: (...args: unknown[]) =>
        mockGetRemoteMusicClient(...args),
}));

jest.mock("@/core/webdav-download/config", () => ({
    readRemoteMusicConfigSnapshot: () => ({}),
}));

jest.mock("@/core/remote-storage/resolve", () => ({
    createWebdavRemoteStorageClient: (...args: unknown[]) =>
        mockCreateWebdavRemoteStorageClient(...args),
    shouldUseWebdavPlaybackFallback: (...args: unknown[]) =>
        mockShouldUseWebdavPlaybackFallback(...args),
}));

jest.mock("@/core/remote-storage/remote-config", () => ({
    isWebdavCredentialsCompleteInConfig: (...args: unknown[]) =>
        mockIsWebdavCredentialsCompleteInConfig(...args),
    getRemoteStorageCredentialsFromConfig: (...args: unknown[]) =>
        mockGetRemoteStorageCredentialsFromConfig(...args),
}));

describe("playback-client fallback", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockShouldUseWebdavPlaybackFallback.mockReturnValue(false);
        mockIsWebdavCredentialsCompleteInConfig.mockReturnValue(false);
        mockGetRemoteStorageCredentialsFromConfig.mockReturnValue({});
    });

    it("uses primary client when fallback is inactive", async () => {
        const primary = {
            exists: jest.fn().mockResolvedValue(true),
            getText: jest.fn(),
            getDownloadUrl: jest.fn(),
        };
        mockGetRemoteMusicClient.mockReturnValue(primary);

        await expect(remoteExistsForPlayback("/song.mp3")).resolves.toBe(true);
        expect(primary.exists).toHaveBeenCalledWith("/song.mp3");
        expect(mockCreateWebdavRemoteStorageClient).not.toHaveBeenCalled();
    });

    it("falls back to webdav when primary exists returns false", async () => {
        mockShouldUseWebdavPlaybackFallback.mockReturnValue(true);
        mockIsWebdavCredentialsCompleteInConfig.mockReturnValue(true);
        mockGetRemoteStorageCredentialsFromConfig.mockReturnValue({
            webdav: {
                url: "https://dav.example",
                rootPath: "/root",
                username: "user",
                password: "pass",
            },
        });

        const primary = {
            exists: jest.fn().mockResolvedValue(false),
        };
        const fallback = {
            exists: jest.fn().mockResolvedValue(true),
        };
        mockGetRemoteMusicClient.mockReturnValue(primary);
        mockCreateWebdavRemoteStorageClient.mockReturnValue(fallback);

        await expect(remoteExistsForPlayback("/song.mp3")).resolves.toBe(true);
        expect(fallback.exists).toHaveBeenCalledWith("/song.mp3");
    });

    it("falls back to webdav when primary client construction fails", async () => {
        mockShouldUseWebdavPlaybackFallback.mockReturnValue(true);
        mockIsWebdavCredentialsCompleteInConfig.mockReturnValue(true);
        mockGetRemoteStorageCredentialsFromConfig.mockReturnValue({
            webdav: {
                url: "https://dav-a.example",
                rootPath: "",
                username: "user",
                password: "pass",
            },
        });

        mockGetRemoteMusicClient.mockImplementation(() => {
            throw new RemoteMusicConfigIncompleteError();
        });

        const fallback = {
            getDownloadUrl: jest.fn().mockResolvedValue("https://dav.example/song.mp3"),
        };
        mockCreateWebdavRemoteStorageClient.mockReturnValue(fallback);

        await expect(getRemoteDownloadUrl("/song.mp3")).resolves.toBe(
            "https://dav.example/song.mp3",
        );
    });

    it("falls back to webdav when primary getText throws", async () => {
        mockShouldUseWebdavPlaybackFallback.mockReturnValue(true);
        mockIsWebdavCredentialsCompleteInConfig.mockReturnValue(true);
        mockGetRemoteStorageCredentialsFromConfig.mockReturnValue({
            webdav: {
                url: "https://dav-b.example",
                rootPath: "",
                username: "user",
                password: "pass",
            },
        });

        const primary = {
            getText: jest.fn().mockRejectedValue(new Error("PCLOUD_API_")),
        };
        const fallback = {
            getText: jest.fn().mockResolvedValue("[00:00.00]lyric"),
        };
        mockGetRemoteMusicClient.mockReturnValue(primary);
        mockCreateWebdavRemoteStorageClient.mockReturnValue(fallback);

        await expect(getRemoteTextForPlayback("/song.lrc")).resolves.toBe(
            "[00:00.00]lyric",
        );
    });
});
