import { remotePathFor } from "@/core/webdav-download/path";

import { normalizeRemotePath } from "./paths";

export const LEGACY_REMOTE_BACKUP_DIR = "/MusicFree";
export const LEGACY_REMOTE_BACKUP_FILE = "/MusicFree/MusicFreeBackup.json";

export function normalizeWebdavCredentialsUrl(url: string): string {
    return url.trim().replace(/\\/g, "/");
}

export function normalizeWebdavRootPath(path: string | undefined | null): string {
    const normalized = path?.trim().replace(/\\/g, "/") ?? "";
    if (!normalized) {
        return "";
    }
    const withLeading = normalized.startsWith("/")
        ? normalized
        : `/${normalized}`;
    const withoutTrailing = withLeading.replace(/\/+$/, "");
    return withoutTrailing || "/";
}

export function isPcloudWebdavHost(url: string): boolean {
    try {
        const parsed = new URL(normalizeWebdavCredentialsUrl(url));
        const host = parsed.hostname.toLowerCase();
        return host === "webdav.pcloud.com" || host === "ewebdav.pcloud.com";
    } catch {
        return false;
    }
}

/** WebDAV server URL without a folder path (pCloud always uses account-root paths). */
export function normalizeWebdavServerUrl(url: string): string {
    const normalized = normalizeWebdavCredentialsUrl(url);
    if (!normalized) {
        return "";
    }
    if (isPcloudWebdavHost(normalized)) {
        try {
            const parsed = new URL(
                normalized.endsWith("/") ? normalized : `${normalized}/`,
            );
            return `${parsed.protocol}//${parsed.host}/`;
        } catch {
            return normalized;
        }
    }
    return normalized;
}

function extractUrlPathname(url: string): string {
    try {
        const normalized = normalizeWebdavCredentialsUrl(url);
        const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
        const parsed = new URL(withSlash);
        let pathname = parsed.pathname || "/";
        pathname = pathname.replace(/\/+$/, "") || "/";
        return pathname === "/" ? "" : pathname;
    } catch {
        return "";
    }
}

export function splitWebdavUrlIntoServerAndRoot(url: string): {
    serverUrl: string;
    rootPath: string;
} {
    const normalized = normalizeWebdavCredentialsUrl(url);
    if (!normalized) {
        return { serverUrl: "", rootPath: "" };
    }
    const pathname = extractUrlPathname(normalized);
    if (!pathname) {
        return {
            serverUrl: normalizeWebdavServerUrl(normalized),
            rootPath: "",
        };
    }
    return {
        serverUrl: normalizeWebdavServerUrl(normalized),
        rootPath: normalizeWebdavRootPath(pathname),
    };
}

/** Resolve a path under the configured cloud root folder. */
export function resolveRemoteAbsolutePath(
    rootPath: string,
    path: string,
): string {
    const normalizedPath = normalizeRemotePath(path);
    if (!normalizedPath) {
        return "/";
    }
    const root = normalizeWebdavRootPath(rootPath);
    if (!root) {
        return normalizedPath;
    }
    if (
        normalizedPath === root
        || normalizedPath.startsWith(`${root}/`)
    ) {
        return normalizedPath;
    }
    const relative = normalizedPath.replace(/^\/+/, "");
    return remotePathFor(root, relative);
}

export function resolveWebdavClientPath(
    serverUrl: string,
    rootPath: string,
    resourcePath: string,
): string {
    const absolute = resolveRemoteAbsolutePath(rootPath, resourcePath);
    if (isPcloudWebdavHost(serverUrl)) {
        return normalizeRemotePath(absolute);
    }
    const mountPath = extractUrlPathname(serverUrl);
    if (!mountPath) {
        return normalizeRemotePath(absolute);
    }
    if (absolute === mountPath || absolute.startsWith(`${mountPath}/`)) {
        const relative = absolute.slice(mountPath.length);
        return relative.startsWith("/") ? relative : `/${relative}`;
    }
    return normalizeRemotePath(absolute);
}

export function getRemoteBackupPaths(rootPath: string): {
    dir: string;
    file: string;
    legacyFile: string;
} {
    const root = normalizeWebdavRootPath(rootPath);
    if (!root) {
        return {
            dir: LEGACY_REMOTE_BACKUP_DIR,
            file: LEGACY_REMOTE_BACKUP_FILE,
            legacyFile: LEGACY_REMOTE_BACKUP_FILE,
        };
    }
    const dir = resolveRemoteAbsolutePath(root, LEGACY_REMOTE_BACKUP_DIR);
    const file = resolveRemoteAbsolutePath(root, LEGACY_REMOTE_BACKUP_FILE);
    return {
        dir,
        file,
        legacyFile: LEGACY_REMOTE_BACKUP_FILE,
    };
}
