const mockProbe = jest.fn();
const mockCreateWithTransport = jest.fn();
const mockReadSnapshot = jest.fn();
const mockReadFile = jest.fn();

jest.mock("react-native-fs", () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
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
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("reads bytes via fetch(file://) + arrayBuffer, not RNFS base64", async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            arrayBuffer: async () => bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            ),
        } as Response);

        const result = await readLocalBinaryBytes("/cache/large.flac");

        expect(global.fetch).toHaveBeenCalledWith("file:///cache/large.flac");
        expect(result).toEqual(bytes);
        expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("strips an existing file:// prefix before fetching", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            arrayBuffer: async () => new ArrayBuffer(0),
        } as Response);

        await readLocalBinaryBytes("file:///tmp/song.mp3");

        expect(global.fetch).toHaveBeenCalledWith("file:///tmp/song.mp3");
    });
});

describe("uploadDownloadArtifacts binary path", () => {
    const originalFetch = global.fetch;
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

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("uploads audio without calling readFile(..., base64)", async () => {
        const audioBytes = new Uint8Array(64 * 1024).fill(0xab);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            arrayBuffer: async () =>
                audioBytes.buffer.slice(
                    audioBytes.byteOffset,
                    audioBytes.byteOffset + audioBytes.byteLength,
                ),
        } as Response);
        mockReadFile.mockResolvedValue("[ti:test]\n");

        await uploadDownloadArtifacts({
            localAudioPath: "/cache/track.flac",
            audioFilename: "title@artist.flac",
            localLrcPath: "/cache/track.lrc",
        });

        expect(global.fetch).toHaveBeenCalledWith("file:///cache/track.flac");
        expect(putBinary).toHaveBeenCalledTimes(1);
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
