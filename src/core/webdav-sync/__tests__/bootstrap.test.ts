import type { RemoteStorageClient } from "@/core/remote-storage/types";

jest.mock("@/core/backup", () => ({
    __esModule: true,
    default: {
        resumeFromWebdavRemote: jest.fn(),
    },
}));

jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: {
        backupSheets: jest.fn(() => []),
    },
}));

jest.mock("../empty-remote-dialog", () => ({
    confirmEmptyRemoteOverwrite: jest.fn(),
}));

jest.mock("@/utils/log", () => ({
    trace: jest.fn(),
}));

jest.mock("@/utils/persistStatus", () => ({
    __esModule: true,
    default: {
        get: jest.fn(() => false),
    },
}));

jest.mock("../upload", () => ({
    flushRemoteUpload: jest.fn(),
}));

import { fetchRemoteBackupRaw } from "../bootstrap";

jest.mock("../config", () => ({
    isRemoteCredentialsComplete: jest.fn(() => true),
}));

jest.mock("../remote-client", () => ({
    getActiveRemoteStorageClient: jest.fn(),
    getActiveRemoteBackupPaths: jest.fn(),
}));

const { getActiveRemoteStorageClient, getActiveRemoteBackupPaths } =
    jest.requireMock("../remote-client") as {
        getActiveRemoteStorageClient: jest.Mock;
        getActiveRemoteBackupPaths: jest.Mock;
    };

function mockClient(
    handlers: Partial<RemoteStorageClient>,
): RemoteStorageClient {
    return {
        exists: jest.fn(),
        getText: jest.fn(),
        getBinary: jest.fn(),
        putText: jest.fn(),
        putBinary: jest.fn(),
        ensureDir: jest.fn(),
        deleteFile: jest.fn(),
        moveFile: jest.fn(),
        listDirectory: jest.fn(),
        getDownloadUrl: jest.fn(),
        ...handlers,
    };
}

describe("fetchRemoteBackupRaw", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("reads canonical backup path under cloud root", async () => {
        const canonicalFile =
            "/(Reinstall)/BACKUP/MusicFree/MusicFreeBackup.json";
        const client = mockClient({
            exists: jest
                .fn()
                .mockImplementation(async (path: string) => path === canonicalFile),
            getText: jest.fn().mockResolvedValue('{"musicSheets":[]}'),
        });
        getActiveRemoteStorageClient.mockReturnValue(client);
        getActiveRemoteBackupPaths.mockReturnValue({
            dir: "/(Reinstall)/BACKUP/MusicFree",
            file: canonicalFile,
            legacyFile: "/MusicFree/MusicFreeBackup.json",
        });

        await expect(fetchRemoteBackupRaw()).resolves.toBe('{"musicSheets":[]}');
        expect(client.getText).toHaveBeenCalledWith(canonicalFile);
    });

    it("falls back to legacy backup path on restore when canonical file is missing", async () => {
        const canonicalFile =
            "/(Reinstall)/BACKUP/MusicFree/MusicFreeBackup.json";
        const legacyFile = "/MusicFree/MusicFreeBackup.json";
        const client = mockClient({
            exists: jest
                .fn()
                .mockImplementation(
                    async (path: string) => path === legacyFile,
                ),
            getText: jest.fn().mockResolvedValue('{"musicSheets":[{"musicList":[]}]}'),
        });
        getActiveRemoteStorageClient.mockReturnValue(client);
        getActiveRemoteBackupPaths.mockReturnValue({
            dir: "/(Reinstall)/BACKUP/MusicFree",
            file: canonicalFile,
            legacyFile,
        });

        await expect(fetchRemoteBackupRaw()).resolves.toBe(
            '{"musicSheets":[{"musicList":[]}]}',
        );
        expect(client.getText).toHaveBeenCalledWith(legacyFile);
    });

    it("returns null when neither canonical nor legacy backup exists", async () => {
        const client = mockClient({
            exists: jest.fn().mockResolvedValue(false),
        });
        getActiveRemoteStorageClient.mockReturnValue(client);
        getActiveRemoteBackupPaths.mockReturnValue({
            dir: "/(Reinstall)/BACKUP/MusicFree",
            file: "/(Reinstall)/BACKUP/MusicFree/MusicFreeBackup.json",
            legacyFile: "/MusicFree/MusicFreeBackup.json",
        });

        await expect(fetchRemoteBackupRaw()).resolves.toBeNull();
    });
});
