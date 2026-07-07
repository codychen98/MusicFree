import Backup from "@/core/backup";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { LEGACY_REMOTE_BACKUP_FILE } from "@/core/remote-storage/remote-paths";
import { RemoteCredentialsIncompleteError } from "@/core/remote-storage/types";

import { registerWebdavMark } from "./bridge";
import {
    isRemoteAutoSyncEnabled,
    isRemoteCredentialsComplete,
    isRemotePendingPush,
    recordRemoteUploadSuccess,
    setRemotePendingPush,
} from "./config";
import { getActiveRemoteBackupPaths, getActiveRemoteStorageClient } from "./remote-client";
import { isWebdavNotifySuppressed } from "./suppress";

export { RemoteCredentialsIncompleteError };

/** @deprecated Use RemoteCredentialsIncompleteError */
export class WebdavCredentialsIncompleteError extends RemoteCredentialsIncompleteError {
    constructor() {
        super();
        this.name = "WebdavCredentialsIncompleteError";
    }
}

const UPLOAD_DEBOUNCE_MS = 3000;

/** Canonical remote backup path (parity with Desktop / Android Settings remote restore). */
export const WEBDAV_REMOTE_BACKUP_FILE = LEGACY_REMOTE_BACKUP_FILE;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let setupListenersDone = false;

function remoteMarkAfterLocalChange(): void {
    if (isWebdavNotifySuppressed() || !isRemoteAutoSyncEnabled()) {
        return;
    }
    setRemotePendingPush(true);
    scheduleDebouncedRemoteUpload();
}

registerWebdavMark(remoteMarkAfterLocalChange);

export async function uploadBackupToRemote(): Promise<void> {
    if (!isRemoteCredentialsComplete()) {
        throw new RemoteCredentialsIncompleteError();
    }
    const client = getActiveRemoteStorageClient();
    const paths = getActiveRemoteBackupPaths();
    const raw = Backup.stringifyWebdavBackupWithSyncMeta();
    await client.ensureDir(paths.dir);
    await client.putText(paths.file, raw);
}

/** @deprecated Use uploadBackupToRemote */
export const uploadBackupToWebdav = uploadBackupToRemote;

export async function flushRemoteUpload(): Promise<boolean> {
    if (!isRemoteAutoSyncEnabled() || !isRemoteCredentialsComplete()) {
        return false;
    }
    try {
        await uploadBackupToRemote();
        recordRemoteUploadSuccess();
        return true;
    } catch {
        setRemotePendingPush(true);
        return false;
    }
}

/** @deprecated Use flushRemoteUpload */
export const flushWebdavUpload = flushRemoteUpload;

function debouncedFlushRemoteUpload(): void {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void flushRemoteUpload();
    }, UPLOAD_DEBOUNCE_MS);
}

export function scheduleDebouncedRemoteUpload(): void {
    if (!isRemoteAutoSyncEnabled() || !isRemoteCredentialsComplete()) {
        return;
    }
    debouncedFlushRemoteUpload();
}

/** @deprecated Use scheduleDebouncedRemoteUpload */
export const scheduleDebouncedWebdavUpload = scheduleDebouncedRemoteUpload;

export function cancelScheduledRemoteUpload(): void {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}

/** @deprecated Use cancelScheduledRemoteUpload */
export const cancelScheduledWebdavUpload = cancelScheduledRemoteUpload;

const REMOTE_CREDENTIAL_KEYS = new Set([
    "backup.webdav.url",
    "backup.webdav.username",
    "backup.webdav.password",
    "backup.remote.pcloud.hostname",
    "backup.remote.pcloud.tokenJson",
    "backup.remote.autoSync",
    "webdav.url",
    "webdav.username",
    "webdav.password",
    "webdav.autoSync",
]);

export function setupRemoteAutoSync(): void {
    if (setupListenersDone) {
        return;
    }
    setupListenersDone = true;
    const configStore = getOrCreateMMKV("App.config");
    configStore.addOnValueChangedListener(changedKey => {
        if (!isRemoteAutoSyncEnabled()) {
            return;
        }
        if (!REMOTE_CREDENTIAL_KEYS.has(changedKey)) {
            return;
        }
        if (isRemotePendingPush()) {
            scheduleDebouncedRemoteUpload();
        }
    });
}

/** @deprecated Use setupRemoteAutoSync */
export const setupWebdavAutoSync = setupRemoteAutoSync;
