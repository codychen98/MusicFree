const mockProbe = jest.fn();
const mockCreateWithTransport = jest.fn();
const mockReadSnapshot = jest.fn();
const mockReadFile = jest.fn();
const mockFileBytes = jest.fn();

jest.mock("react-native-fs", () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
}));

jest.mock("expo-file-system/next", () => ({
    File: jest.fn().mockImplementation(() => ({
        bytes: (...args: unknown[]) => mockFileBytes(...args),
    })),
}));

jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
}));

jest.mock("@/core/remote-storage/probe-remote-transport", () => ({
    probeVerifiedRemoteTransport: (...args: unknown[]) => mockProbe(...args),
}));

jest.mock("@/core/remote-storage/resolve", () => {
    const actual = jest.requireActual(
        "@/core/remote-storage/resolve",
    ) as typeof import("@/core/remote-storage/resolve");
    return {
        ...actual,
        createRemoteStorageClientWithTransport: (...args: unknown[]) =>
            mockCreateWithTransport(...args),
    };
});

jest.mock("../config", () => ({
    readRemoteMusicConfigSnapshot: (...args: unknown[]) =>
        mockReadSnapshot(...args),
}));

import { File } from "expo-file-system/next";
import {
    readLocalBinaryBytes,
    resetRemoteMusicClientCache,
    uploadDownloadArtifacts,
} from "../upload";

const TOKEN_JSON =
    '{"access_token":"tok","token_type":"bearer"}';

function musicSnapshot() {
    return {
        "backup.webdav.url": "https://webdav.example",
        "backup.webdav.rootPath": "/(Reinstall)/BACKUP",
        "backup.webdav.username": "user",
        "backup.webdav.password": "pass",
        "backup.remote.pcloud.hostname": "api.pcloud.com",
        "backup.remote.pcloud.tokenJson": TOKEN_JSON,
        "backup.remote.musicPath": "/(Reinstall)/BACKUP/MusicFree/Download",
    };
}

describe("readLocalBinaryBytes", () => {
    afterEach(() => {
        mockFileBytes.mockReset();
        (File as unknown as jest.Mock).mockClear();
        mockReadFile.mockReset();
    });

    it("reads bytes via File.bytes(), not fetch(file://) or RNFS base64", async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        mockFileBytes.mockReturnValue(bytes);

        const result = await readLocalBinaryBytes("/cache/large.flac");

        expect(File).toHaveBeenCalledWith("file:///cache/large.flac");
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result).toEqual(bytes);
        expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("strips an existing file:// prefix before constructing File", async () => {
        mockFileBytes.mockReturnValue(new Uint8Array(0));

        await readLocalBinaryBytes("file:///tmp/song.mp3");

        expect(File).toHaveBeenCalledWith("file:///tmp/song.mp3");
    });
});

describe("uploadDownloadArtifacts binary path", () => {
    let putBinary: jest.Mock;
    let putText: jest.Mock;
    let exists: jest.Mock;
    let ensureDir: jest.Mock;

    beforeEach(() => {
        resetRemoteMusicClientCache();
        mockProbe.mockReset();
        mockCreateWithTransport.mockReset();
        mockReadSnapshot.mockReset();
        mockReadFile.mockReset();
        mockFileBytes.mockReset();
        (File as unknown as jest.Mock).mockClear();
        mockReadSnapshot.mockReturnValue(musicSnapshot());
        mockProbe.mockResolvedValue("webdav");
        putBinary = jest.fn().mockResolvedValue(undefined);
        putText = jest.fn().mockResolvedValue(undefined);
        exists = jest.fn().mockResolvedValue(false);
        ensureDir = jest.fn().mockResolvedValue(undefined);
        mockCreateWithTransport.mockReturnValue({
            transport: "webdav",
            exists,
            ensureDir,
            putBinary,
            putText,
        });
    });

    it("uploads audio without calling readFile(..., base64)", async () => {
        const audioBytes = new Uint8Array(64 * 1024).fill(0xab);
        mockFileBytes.mockReturnValue(audioBytes);
        mockReadFile.mockResolvedValue("[ti:test]\n");

        await uploadDownloadArtifacts({
            localAudioPath: "/cache/track.flac",
            audioFilename: "title@artist.flac",
            localLrcPath: "/cache/track.lrc",
        });

        expect(File).toHaveBeenCalledWith("file:///cache/track.flac");
        expect(putBinary).toHaveBeenCalledTimes(1);
        expect(putBinary.mock.calls[0][1]).toBeInstanceOf(Uint8Array);
        expect(putBinary.mock.calls[0][1]).toEqual(audioBytes);
        expect(mockReadFile).toHaveBeenCalledWith("/cache/track.lrc", "utf8");
        expect(
            mockReadFile.mock.calls.some(
                call => call[1] === "base64",
            ),
        ).toBe(false);
        expect(putText).toHaveBeenCalledTimes(1);
    });
});
