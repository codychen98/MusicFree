import Backup from "@/core/backup";
import Config from "@/core/appConfig";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { AuthType, createClient } from "webdav";
import {
    isWebdavAutoSyncEnabled,
    isWebdavCredentialsComplete,
    recordWebdavUploadSuccess,
    setWebdavPendingPush,
} from "./config";
import { registerWebdavMark } from "./bridge";
import { isWebdavNotifySuppressed } from "./suppress";

export class WebdavCredentialsIncompleteError extends Error {
    constructor() {
        super("WEBDAV_CREDENTIALS_INCOMPLETE");
        this.name = "WebdavCredentialsIncompleteError";
    }
}

const UPLOAD_DEBOUNCE_MS = 3000;
const WEBDAV_BACKUP_DIR = "/MusicFree";

/** Canonical remote backup path (parity with Desktop / Android Settings WebDAV restore). */
export const WEBDAV_REMOTE_BACKUP_FILE = "/MusicFree/MusicFreeBackup.json";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let setupListenersDone = false;

function webdavMarkAfterLocalChange(): void {
    if (isWebdavNotifySuppressed() || !isWebdavAutoSyncEnabled()) {
        return;
    }
    setWebdavPendingPush(true);
    scheduleDebouncedWebdavUpload();
}

registerWebdavMark(webdavMarkAfterLocalChange);

export async function uploadBackupToWebdav(): Promise<void> {
    const url = Config.getConfig("webdav.url");
    const username = Config.getConfig("webdav.username");
    const password = Config.getConfig("webdav.password");
    if (!url || !username || !password) {
        throw new WebdavCredentialsIncompleteError();
    }
    const client = createClient(url, {
        authType: AuthType.Password,
        username,
        password,
    });
    const raw = Backup.stringifyWebdavBackupWithSyncMeta();
    if (!(await client.exists(WEBDAV_BACKUP_DIR))) {
        await client.createDirectory(WEBDAV_BACKUP_DIR);
    }
    await client.putFileContents(WEBDAV_REMOTE_BACKUP_FILE, raw, {
        overwrite: true,
    });
}

export async function flushWebdavUpload(): Promise<boolean> {
    if (!isWebdavAutoSyncEnabled() || !isWebdavCredentialsComplete()) {
        return false;
    }
    try {
        await uploadBackupToWebdav();
        recordWebdavUploadSuccess();
        return true;
    } catch {
        setWebdavPendingPush(true);
        return false;
    }
}

function debouncedFlushWebdavUpload(): void {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void flushWebdavUpload();
    }, UPLOAD_DEBOUNCE_MS);
}

export function scheduleDebouncedWebdavUpload(): void {
    if (!isWebdavAutoSyncEnabled() || !isWebdavCredentialsComplete()) {
        return;
    }
    debouncedFlushWebdavUpload();
}

export function cancelScheduledWebdavUpload(): void {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}

export function setupWebdavAutoSync(): void {
    if (setupListenersDone) {
        return;
    }
    setupListenersDone = true;
    const configStore = getOrCreateMMKV("App.config");
    configStore.addOnValueChangedListener(changedKey => {
        if (!isWebdavAutoSyncEnabled()) {
            return;
        }
        const credentialsOrAutoTouched =
            changedKey === "webdav.url" ||
            changedKey === "webdav.username" ||
            changedKey === "webdav.password" ||
            changedKey === "webdav.autoSync";
        if (!credentialsOrAutoTouched) {
            return;
        }
        if (Config.getConfig("webdav.pendingPush") === true) {
            scheduleDebouncedWebdavUpload();
        }
    });
}
