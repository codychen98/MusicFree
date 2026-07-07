import { buildLegacyRemoteConfigMigration } from "../migrate-legacy-config";
import {
    getRemoteAutoSync,
    getRemoteBackupSourceDeviceId,
    getRemoteMusicPath,
    getRemotePendingPush,
    getRemoteStorageCredentialsFromConfig,
    isRemoteCredentialsCompleteInConfig,
    isWebdavCredentialsCompleteInConfig,
    normalizeRemoteConfigPatch,
    type RemoteConfigSnapshot,
} from "../remote-config";

function rawKeysOf(config: RemoteConfigSnapshot): Set<string> {
    return new Set(Object.keys(config));
}

describe("buildLegacyRemoteConfigMigration", () => {
    it("does not migrate on fresh install", () => {
        const config: RemoteConfigSnapshot = {
            "backup.webdav.url": "",
            "backup.webdav.username": "",
            "backup.webdav.password": "",
        };
        const result = buildLegacyRemoteConfigMigration(config, {
            rawKeys: rawKeysOf(config),
        });
        expect(result.migrated).toBe(false);
        expect(result.patch).toEqual({});
    });

    it("migrates legacy webdav.url with path into server and rootPath", () => {
        const config: RemoteConfigSnapshot = {
            "webdav.url": "https://webdav.pcloud.com/(Reinstall)/BACKUP",
            "webdav.username": "alice",
            "webdav.password": "secret",
        };
        const result = buildLegacyRemoteConfigMigration(config, {
            rawKeys: rawKeysOf(config),
        });
        expect(result.patch["backup.webdav.url"]).toBe("https://webdav.pcloud.com/");
        expect(result.patch["backup.webdav.rootPath"]).toBe("/(Reinstall)/BACKUP");
        expect(result.patch["backup.webdav.username"]).toBe("alice");
        expect(result.patch["backup.webdav.password"]).toBe("secret");
    });

    it("copies plugin searchPath to backup.remote.musicPath", () => {
        const config: RemoteConfigSnapshot = {};
        const result = buildLegacyRemoteConfigMigration(config, {
            rawKeys: rawKeysOf(config),
            pluginUserVariables: {
                searchPath: "/Music/Download",
                url: "https://dav.example.com",
                username: "user",
                password: "pass",
            },
        });
        expect(result.patch["backup.remote.musicPath"]).toBe("/Music/Download");
    });

    it("copies plugin creds when backup and legacy webdav are empty", () => {
        const config: RemoteConfigSnapshot = {};
        const result = buildLegacyRemoteConfigMigration(config, {
            rawKeys: rawKeysOf(config),
            pluginUserVariables: {
                url: "https://dav.example.com/folder",
                username: "alice",
                password: "secret",
            },
        });
        expect(result.patch["backup.webdav.url"]).toBe("https://dav.example.com/folder");
        expect(result.patch["backup.webdav.username"]).toBe("alice");
        expect(result.patch["backup.webdav.password"]).toBe("secret");
    });

    it("skips plugin webdav creds when pCloud is complete", () => {
        const config: RemoteConfigSnapshot = {
            "backup.remote.pcloud.tokenJson":
                "{\"access_token\":\"tok\",\"token_type\":\"bearer\"}",
        };
        const result = buildLegacyRemoteConfigMigration(config, {
            rawKeys: rawKeysOf(config),
            pluginUserVariables: {
                url: "https://dav.example.com",
                username: "alice",
                password: "secret",
            },
        });
        expect(result.patch["backup.webdav.url"]).toBeUndefined();
    });

    it("does not overwrite existing musicPath", () => {
        const config: RemoteConfigSnapshot = {
            "backup.remote.musicPath": "/existing/path",
        };
        const result = buildLegacyRemoteConfigMigration(config, {
            rawKeys: rawKeysOf(config),
            pluginUserVariables: {
                searchPath: "/plugin/path",
            },
        });
        expect(result.patch["backup.remote.musicPath"]).toBeUndefined();
    });

    it("migrates legacy webdav sync flags to backup.remote.*", () => {
        const config: RemoteConfigSnapshot = {
            "webdav.autoSync": true,
            "webdav.pendingPush": true,
            "webdav.lastSuccessfulPushAt": 12345,
            "webdav.backupSourceDeviceId": "device-1",
        };
        const result = buildLegacyRemoteConfigMigration(config, {
            rawKeys: rawKeysOf(config),
        });
        expect(result.patch["backup.remote.autoSync"]).toBe(true);
        expect(result.patch["backup.remote.pendingPush"]).toBe(true);
        expect(result.patch["backup.remote.lastSuccessfulPushAt"]).toBe(12345);
        expect(result.patch["backup.remote.backupSourceDeviceId"]).toBe("device-1");
    });
});

describe("remote-config read shim", () => {
    it("reads webdav creds from legacy keys when backup keys are empty", () => {
        const config: RemoteConfigSnapshot = {
            "webdav.url": "https://dav.example.com",
            "webdav.username": "alice",
            "webdav.password": "secret",
        };
        expect(isWebdavCredentialsCompleteInConfig(config)).toBe(true);
        expect(getRemoteStorageCredentialsFromConfig(config).webdav?.url).toBe(
            "https://dav.example.com",
        );
    });

    it("prefers backup.webdav keys over legacy webdav keys", () => {
        const config: RemoteConfigSnapshot = {
            "backup.webdav.url": "https://backup.example.com",
            "backup.webdav.username": "backup-user",
            "backup.webdav.password": "backup-pass",
            "webdav.url": "https://legacy.example.com",
            "webdav.username": "legacy-user",
            "webdav.password": "legacy-pass",
        };
        expect(getRemoteStorageCredentialsFromConfig(config).webdav?.url).toBe(
            "https://backup.example.com",
        );
    });

    it("reads sync flags from legacy webdav keys", () => {
        const config: RemoteConfigSnapshot = {
            "webdav.autoSync": true,
            "webdav.pendingPush": true,
            "webdav.backupSourceDeviceId": "device-legacy",
        };
        expect(getRemoteAutoSync(config)).toBe(true);
        expect(getRemotePendingPush(config)).toBe(true);
        expect(getRemoteBackupSourceDeviceId(config)).toBe("device-legacy");
    });

    it("normalizes patch and mirrors legacy sync writes", () => {
        const patch = normalizeRemoteConfigPatch({
            "webdav.autoSync": true,
            "webdav.pendingPush": true,
        });
        expect(patch["backup.remote.autoSync"]).toBe(true);
        expect(patch["backup.remote.pendingPush"]).toBe(true);
    });

    it("clears pending push when remote autoSync is turned off", () => {
        const patch = normalizeRemoteConfigPatch({
            "backup.remote.autoSync": false,
            "backup.remote.pendingPush": true,
        });
        expect(patch["backup.remote.pendingPush"]).toBe(false);
    });

    it("resolves remote credentials from migrated-shaped config", () => {
        const config: RemoteConfigSnapshot = {
            "backup.webdav.url": "https://dav.example.com",
            "backup.webdav.username": "alice",
            "backup.webdav.password": "secret",
            "backup.remote.musicPath": "/music",
        };
        expect(isRemoteCredentialsCompleteInConfig(config)).toBe(true);
        expect(getRemoteMusicPath(config)).toBe("/music");
    });
});
