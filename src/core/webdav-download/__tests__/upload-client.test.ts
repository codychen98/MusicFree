import { RemoteTransportOfflineError } from "@/core/remote-storage/types";

const mockProbe = jest.fn();
const mockCreateWithTransport = jest.fn();
const mockReadSnapshot = jest.fn();

jest.mock("react-native-fs", () => ({
    readFile: jest.fn(),
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
    getRemoteMusicClient,
    resetRemoteMusicClientCache,
} from "../upload";

const TOKEN_JSON =
    '{"access_token":"tok","token_type":"bearer"}';

function bothTransportsSnapshot() {
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

describe("getRemoteMusicClient (probe)", () => {
    beforeEach(() => {
        resetRemoteMusicClientCache();
        mockProbe.mockReset();
        mockCreateWithTransport.mockReset();
        mockReadSnapshot.mockReset();
        mockReadSnapshot.mockReturnValue(bothTransportsSnapshot());
        mockCreateWithTransport.mockImplementation((_creds, transport) => ({
            transport,
            exists: jest.fn(),
            ensureDir: jest.fn(),
            putBinary: jest.fn(),
            putText: jest.fn(),
        }));
    });

    it("creates a webdav client when probe returns webdav", async () => {
        mockProbe.mockResolvedValue("webdav");

        const client = await getRemoteMusicClient();

        expect(mockProbe).toHaveBeenCalledTimes(1);
        expect(mockCreateWithTransport).toHaveBeenCalledTimes(1);
        expect(mockCreateWithTransport.mock.calls[0][1]).toBe("webdav");
        expect((client as { transport: string }).transport).toBe("webdav");
    });

    it("creates a pcloud client when probe returns pcloud", async () => {
        mockProbe.mockResolvedValue("pcloud");

        const client = await getRemoteMusicClient();

        expect(mockCreateWithTransport.mock.calls[0][1]).toBe("pcloud");
        expect((client as { transport: string }).transport).toBe("pcloud");
    });

    it("throws RemoteTransportOfflineError when both transports are offline", async () => {
        mockProbe.mockResolvedValue("both_offline");

        await expect(getRemoteMusicClient()).rejects.toBeInstanceOf(
            RemoteTransportOfflineError,
        );
        expect(mockCreateWithTransport).not.toHaveBeenCalled();
    });

    it("throws RemoteTransportOfflineError when probe reports offline", async () => {
        mockProbe.mockResolvedValue("offline");

        await expect(getRemoteMusicClient()).rejects.toBeInstanceOf(
            RemoteTransportOfflineError,
        );
        expect(mockCreateWithTransport).not.toHaveBeenCalled();
    });
});
