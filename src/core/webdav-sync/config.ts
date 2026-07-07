import Config from "@/core/appConfig";
import {
    getRemoteAutoSync,
    getRemotePendingPush,
    isRemoteCredentialsCompleteInConfig,
    type RemoteConfigSnapshot,
} from "@/core/remote-storage/remote-config";

export function readRemoteConfigSnapshot(): RemoteConfigSnapshot {
    return {
        "backup.webdav.url": Config.getConfig("backup.webdav.url"),
        "backup.webdav.rootPath": Config.getConfig("backup.webdav.rootPath"),
        "backup.webdav.username": Config.getConfig("backup.webdav.username"),
        "backup.webdav.password": Config.getConfig("backup.webdav.password"),
        "backup.remote.pcloud.hostname": Config.getConfig(
            "backup.remote.pcloud.hostname",
        ),
        "backup.remote.pcloud.tokenJson": Config.getConfig(
            "backup.remote.pcloud.tokenJson",
        ),
        "backup.remote.autoSync": Config.getConfig("backup.remote.autoSync"),
        "backup.remote.pendingPush": Config.getConfig("backup.remote.pendingPush"),
        "backup.remote.lastSuccessfulPushAt": Config.getConfig(
            "backup.remote.lastSuccessfulPushAt",
        ),
        "backup.remote.backupSourceDeviceId": Config.getConfig(
            "backup.remote.backupSourceDeviceId",
        ),
        "webdav.url": Config.getConfig("webdav.url"),
        "webdav.username": Config.getConfig("webdav.username"),
        "webdav.password": Config.getConfig("webdav.password"),
        "webdav.autoSync": Config.getConfig("webdav.autoSync"),
        "webdav.pendingPush": Config.getConfig("webdav.pendingPush"),
        "webdav.lastSuccessfulPushAt": Config.getConfig(
            "webdav.lastSuccessfulPushAt",
        ),
        "webdav.backupSourceDeviceId": Config.getConfig(
            "webdav.backupSourceDeviceId",
        ),
    };
}

export function isRemoteCredentialsComplete(): boolean {
    return isRemoteCredentialsCompleteInConfig(readRemoteConfigSnapshot());
}

export function isRemoteAutoSyncEnabled(): boolean {
    return getRemoteAutoSync(readRemoteConfigSnapshot());
}

export function isRemotePendingPush(): boolean {
    return getRemotePendingPush(readRemoteConfigSnapshot());
}

export function setRemotePendingPush(value: boolean): void {
    Config.setConfig("backup.remote.pendingPush", value);
}

export function recordRemoteUploadSuccess(): void {
    Config.setConfig("backup.remote.pendingPush", false);
    Config.setConfig("backup.remote.lastSuccessfulPushAt", Date.now());
}

/** After explicit Restore from remote storage — local matches remote snapshot; suppress stale auto-push. */
export function clearRemotePendingPushAfterManualRestore(): void {
    Config.setConfig("backup.remote.pendingPush", false);
}

/** @deprecated Use isRemoteCredentialsComplete */
export const isWebdavCredentialsComplete = isRemoteCredentialsComplete;

/** @deprecated Use isRemoteAutoSyncEnabled */
export const isWebdavAutoSyncEnabled = isRemoteAutoSyncEnabled;

/** @deprecated Use isRemotePendingPush */
export const isWebdavPendingPush = isRemotePendingPush;

/** @deprecated Use setRemotePendingPush */
export const setWebdavPendingPush = setRemotePendingPush;

/** @deprecated Use recordRemoteUploadSuccess */
export const recordWebdavUploadSuccess = recordRemoteUploadSuccess;

/** @deprecated Use clearRemotePendingPushAfterManualRestore */
export const clearWebdavPendingPushAfterManualRestore =
    clearRemotePendingPushAfterManualRestore;
