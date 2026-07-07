import {
    isPcloudCredentialsCompleteInConfig,
    isWebdavCredentialsCompleteInConfig,
    REMOTE_MUSIC_PLUGIN_PLATFORM,
    type RemoteConfigSnapshot,
} from "./remote-config";
import {
    normalizeWebdavRootPath,
    splitWebdavUrlIntoServerAndRoot,
} from "./remote-paths";

export interface LegacyRemoteConfigMigrationContext {
    rawKeys: ReadonlySet<string>;
    pluginUserVariables?: Record<string, string>;
}

export interface LegacyRemoteConfigMigrationResult {
    patch: RemoteConfigSnapshot;
    migrated: boolean;
}

function trim(value: string | undefined | null): string {
    return value?.trim() ?? "";
}

function shouldMigrateMusicPath(
    config: RemoteConfigSnapshot,
    rawKeys: ReadonlySet<string>,
): boolean {
    if (!rawKeys.has("backup.remote.musicPath")) {
        return true;
    }
    return trim(config["backup.remote.musicPath"] as string | undefined) === "";
}

function buildAndroidWebdavNamespaceMigrationPatch(
    config: RemoteConfigSnapshot,
    rawKeys: ReadonlySet<string>,
): RemoteConfigSnapshot {
    const patch: RemoteConfigSnapshot = {};

    if (
        !trim(config["backup.webdav.url"] as string | undefined)
        && trim(config["webdav.url"] as string | undefined)
    ) {
        const split = splitWebdavUrlIntoServerAndRoot(
            config["webdav.url"] as string,
        );
        patch["backup.webdav.url"] = split.serverUrl;
        if (
            split.rootPath
            && !trim(config["backup.webdav.rootPath"] as string | undefined)
        ) {
            patch["backup.webdav.rootPath"] = split.rootPath;
        }
    }

    if (
        !trim(config["backup.webdav.username"] as string | undefined)
        && trim(config["webdav.username"] as string | undefined)
    ) {
        patch["backup.webdav.username"] = config["webdav.username"];
    }

    if (
        !trim(config["backup.webdav.password"] as string | undefined)
        && trim(config["webdav.password"] as string | undefined)
    ) {
        patch["backup.webdav.password"] = config["webdav.password"];
    }

    if (
        !rawKeys.has("backup.remote.autoSync")
        && rawKeys.has("webdav.autoSync")
    ) {
        patch["backup.remote.autoSync"] = config["webdav.autoSync"];
    }
    if (
        !rawKeys.has("backup.remote.pendingPush")
        && rawKeys.has("webdav.pendingPush")
    ) {
        patch["backup.remote.pendingPush"] = config["webdav.pendingPush"];
    }
    if (
        !rawKeys.has("backup.remote.lastSuccessfulPushAt")
        && rawKeys.has("webdav.lastSuccessfulPushAt")
    ) {
        patch["backup.remote.lastSuccessfulPushAt"] =
            config["webdav.lastSuccessfulPushAt"];
    }
    if (
        !rawKeys.has("backup.remote.backupSourceDeviceId")
        && rawKeys.has("webdav.backupSourceDeviceId")
    ) {
        patch["backup.remote.backupSourceDeviceId"] =
            config["webdav.backupSourceDeviceId"];
    }

    return patch;
}

function buildWebdavUrlRootMigrationPatch(
    config: RemoteConfigSnapshot,
    rawKeys: ReadonlySet<string>,
): RemoteConfigSnapshot {
    const patch: RemoteConfigSnapshot = {};
    const currentUrl = trim(config["backup.webdav.url"] as string | undefined);
    const currentRoot = normalizeWebdavRootPath(
        config["backup.webdav.rootPath"] as string | undefined,
    );

    if (currentUrl && !currentRoot) {
        const split = splitWebdavUrlIntoServerAndRoot(currentUrl);
        if (split.rootPath && split.serverUrl !== currentUrl) {
            patch["backup.webdav.url"] = split.serverUrl;
            if (!rawKeys.has("backup.webdav.rootPath") || !currentRoot) {
                patch["backup.webdav.rootPath"] = split.rootPath;
            }
        }
    }

    return patch;
}

/**
 * One-time migration from legacy `webdav.*` app config and WebDAV plugin meta.
 * Does not write back to plugin meta.
 */
export function buildLegacyRemoteConfigMigration(
    config: RemoteConfigSnapshot,
    context: LegacyRemoteConfigMigrationContext,
): LegacyRemoteConfigMigrationResult {
    const patch: RemoteConfigSnapshot = {};
    const { rawKeys, pluginUserVariables = {} } = context;

    Object.assign(patch, buildAndroidWebdavNamespaceMigrationPatch(config, rawKeys));

    const mergedConfig: RemoteConfigSnapshot = { ...config, ...patch };

    if (shouldMigrateMusicPath(mergedConfig, rawKeys)) {
        const searchPath = trim(pluginUserVariables.searchPath);
        if (searchPath) {
            patch["backup.remote.musicPath"] = searchPath;
        }
    }

    const credsConfig: RemoteConfigSnapshot = { ...mergedConfig, ...patch };

    if (
        !isPcloudCredentialsCompleteInConfig(credsConfig)
        && !isWebdavCredentialsCompleteInConfig(credsConfig)
    ) {
        const url = trim(pluginUserVariables.url);
        const username = trim(pluginUserVariables.username);
        const password = trim(pluginUserVariables.password);
        if (url && !trim(credsConfig["backup.webdav.url"] as string | undefined)) {
            const split = splitWebdavUrlIntoServerAndRoot(url);
            patch["backup.webdav.url"] = split.serverUrl;
            if (
                split.rootPath
                && !trim(credsConfig["backup.webdav.rootPath"] as string | undefined)
            ) {
                patch["backup.webdav.rootPath"] = split.rootPath;
            }
        }
        if (
            username
            && !trim(credsConfig["backup.webdav.username"] as string | undefined)
        ) {
            patch["backup.webdav.username"] = username;
        }
        if (
            password
            && !trim(credsConfig["backup.webdav.password"] as string | undefined)
        ) {
            patch["backup.webdav.password"] = password;
        }
    }

    const urlRootConfig: RemoteConfigSnapshot = { ...credsConfig, ...patch };
    Object.assign(
        patch,
        buildWebdavUrlRootMigrationPatch(urlRootConfig, rawKeys),
    );

    const migrated = Object.keys(patch).length > 0;
    return { patch, migrated };
}

export { REMOTE_MUSIC_PLUGIN_PLATFORM };
