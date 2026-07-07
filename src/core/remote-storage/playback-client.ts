import {
    createWebdavRemoteStorageClient,
    shouldUseWebdavPlaybackFallback,
} from "@/core/remote-storage/resolve";
import {
    getRemoteStorageCredentialsFromConfig,
    isWebdavCredentialsCompleteInConfig,
} from "@/core/remote-storage/remote-config";
import type { RemoteStorageClient } from "@/core/remote-storage/types";
import { getRemoteMusicClient } from "@/core/webdav-download/upload";
import { readRemoteMusicConfigSnapshot } from "@/core/webdav-download/config";

let cachedWebdavFallbackClient: RemoteStorageClient | null = null;
let cachedWebdavFallbackKey = "";

function trim(value: string | undefined): string {
    return value?.trim() ?? "";
}

function getWebdavFallbackClient(): RemoteStorageClient | null {
    const snapshot = readRemoteMusicConfigSnapshot();
    if (!isWebdavCredentialsCompleteInConfig(snapshot)) {
        return null;
    }
    const creds = getRemoteStorageCredentialsFromConfig(snapshot);
    const webdav = creds.webdav!;
    const key = `webdav\0${trim(webdav.url)}\0${trim(webdav.rootPath ?? "")}\0${trim(webdav.username)}\0${trim(webdav.password)}`;
    if (cachedWebdavFallbackClient && cachedWebdavFallbackKey === key) {
        return cachedWebdavFallbackClient;
    }
    cachedWebdavFallbackClient = createWebdavRemoteStorageClient({
        url: trim(webdav.url),
        rootPath: trim(webdav.rootPath ?? ""),
        username: trim(webdav.username),
        password: trim(webdav.password),
    });
    cachedWebdavFallbackKey = key;
    return cachedWebdavFallbackClient;
}

function isWebdavPlaybackFallbackActive(): boolean {
    const snapshot = readRemoteMusicConfigSnapshot();
    return shouldUseWebdavPlaybackFallback(
        getRemoteStorageCredentialsFromConfig(snapshot),
    );
}

async function withPlaybackFallback<T>(
    primaryOp: (client: RemoteStorageClient) => Promise<T>,
    fallbackOp: (client: RemoteStorageClient) => Promise<T>,
    shouldFallback: (result: T) => boolean = () => false,
): Promise<T> {
    let primary: RemoteStorageClient;
    try {
        primary = getRemoteMusicClient();
    } catch (primaryError) {
        if (!isWebdavPlaybackFallbackActive()) {
            throw primaryError;
        }
        const fallback = getWebdavFallbackClient();
        if (!fallback) {
            throw primaryError;
        }
        return fallbackOp(fallback);
    }

    try {
        const result = await primaryOp(primary);
        if (!shouldFallback(result)) {
            return result;
        }
        if (!isWebdavPlaybackFallbackActive()) {
            return result;
        }
        const fallback = getWebdavFallbackClient();
        if (!fallback) {
            return result;
        }
        return fallbackOp(fallback);
    } catch (primaryError) {
        if (!isWebdavPlaybackFallbackActive()) {
            throw primaryError;
        }
        const fallback = getWebdavFallbackClient();
        if (!fallback) {
            throw primaryError;
        }
        return fallbackOp(fallback);
    }
}

export async function remoteExistsForPlayback(path: string): Promise<boolean> {
    const normalized = path?.trim();
    if (!normalized) {
        return false;
    }
    return withPlaybackFallback(
        (client) => client.exists(normalized),
        (client) => client.exists(normalized),
        (exists) => !exists,
    );
}

export async function getRemoteTextForPlayback(path: string): Promise<string> {
    const normalized = path?.trim();
    if (!normalized) {
        throw new Error("REMOTE_PATH_MISSING");
    }
    return withPlaybackFallback(
        (client) => client.getText(normalized),
        (client) => client.getText(normalized),
    );
}

export async function getRemoteDownloadUrl(path: string): Promise<string> {
    const normalized = path?.trim();
    if (!normalized) {
        throw new Error("REMOTE_PATH_MISSING");
    }
    return withPlaybackFallback(
        (client) => client.getDownloadUrl(normalized),
        (client) => client.getDownloadUrl(normalized),
    );
}
