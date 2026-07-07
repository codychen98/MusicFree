import Config from "@/core/appConfig";

import {
    isRemoteAutoSyncEnabled,
    isRemoteCredentialsComplete,
    isRemotePendingPush,
    readRemoteConfigSnapshot,
} from "../config";

jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: {
        getConfig: jest.fn(),
        setConfig: jest.fn(),
    },
}));

const mockedGetConfig = Config.getConfig as jest.Mock;

describe("webdav-sync config", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("reads unified remote credentials from backup.* with legacy shim", () => {
        mockedGetConfig.mockImplementation((key: string) => {
            const values: Record<string, unknown> = {
                "backup.webdav.url": "https://webdav.pcloud.com/",
                "backup.webdav.rootPath": "/(Reinstall)/BACKUP",
                "backup.webdav.username": "alice",
                "backup.webdav.password": "secret",
                "backup.remote.pcloud.tokenJson": "",
            };
            return values[key];
        });

        expect(isRemoteCredentialsComplete()).toBe(true);
        expect(readRemoteConfigSnapshot()["backup.webdav.url"]).toBe(
            "https://webdav.pcloud.com/",
        );
    });

    it("prefers backup.remote sync flags over legacy webdav.*", () => {
        mockedGetConfig.mockImplementation((key: string) => {
            const values: Record<string, unknown> = {
                "backup.remote.autoSync": false,
                "webdav.autoSync": true,
                "backup.remote.pendingPush": true,
                "webdav.pendingPush": false,
            };
            return values[key];
        });

        expect(isRemoteAutoSyncEnabled()).toBe(false);
        expect(isRemotePendingPush()).toBe(true);
    });
});
