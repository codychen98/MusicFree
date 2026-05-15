import Config from "@/core/appConfig";

export function isWebdavCredentialsComplete(): boolean {
    const url = Config.getConfig("webdav.url");
    const username = Config.getConfig("webdav.username");
    const password = Config.getConfig("webdav.password");
    return Boolean(url && username && password);
}

export function isWebdavAutoSyncEnabled(): boolean {
    return Config.getConfig("webdav.autoSync") === true;
}

export function isWebdavPendingPush(): boolean {
    return Config.getConfig("webdav.pendingPush") === true;
}

export function setWebdavPendingPush(value: boolean): void {
    Config.setConfig("webdav.pendingPush", value);
}

export function recordWebdavUploadSuccess(): void {
    Config.setConfig("webdav.pendingPush", false);
    Config.setConfig("webdav.lastSuccessfulPushAt", Date.now());
}

/** After explicit Restore from WebDAV — local matches remote snapshot; suppress stale auto-push. */
export function clearWebdavPendingPushAfterManualRestore(): void {
    Config.setConfig("webdav.pendingPush", false);
}

