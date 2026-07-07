import { resolveFirstSearchPathSegment } from "@/core/webdav-download/path";
import type { IAppConfigProperties } from "@/types/core/config";

import { isValidPcloudTokenJson } from "./parse-pcloud-token";
import {
    normalizeWebdavRootPath,
    normalizeWebdavServerUrl,
    splitWebdavUrlIntoServerAndRoot,
} from "./remote-paths";
import { resolveRemoteTransport } from "./resolve";
import type { RemoteStorageCredentials } from "./types";

export const REMOTE_MUSIC_PLUGIN_PLATFORM = "WebDAV" as const;
/** Matches existing DB rows for built-in remote music source. */
export const REMOTE_MUSIC_PLUGIN_HASH = "WebDAV" as const;

const DEFAULT_PCLOUD_HOSTNAME = "api.pcloud.com";

export type RemoteConfigSnapshot = Partial<IAppConfigProperties> &
    Record<string, unknown>;

function trim(value: string | undefined | null): string {
    return value?.trim() ?? "";
}

function readString(
    config: RemoteConfigSnapshot,
    primary: keyof IAppConfigProperties,
    legacy?: keyof IAppConfigProperties,
): string {
    const primaryValue = trim(config[primary] as string | undefined);
    if (primaryValue) {
        return primaryValue;
    }
    if (legacy) {
        return trim(config[legacy] as string | undefined);
    }
    return "";
}

export function isWebdavCredentialsCompleteInConfig(
    config: RemoteConfigSnapshot,
): boolean {
    return Boolean(
        readString(config, "backup.webdav.url", "webdav.url")
            && readString(config, "backup.webdav.username", "webdav.username")
            && readString(config, "backup.webdav.password", "webdav.password"),
    );
}

export function isPcloudCredentialsCompleteInConfig(
    config: RemoteConfigSnapshot,
): boolean {
    const tokenJson = trim(config["backup.remote.pcloud.tokenJson"] as string);
    const hostname = trim(
        (config["backup.remote.pcloud.hostname"] as string | undefined)
            ?? DEFAULT_PCLOUD_HOSTNAME,
    );
    return Boolean(hostname && tokenJson && isValidPcloudTokenJson(tokenJson));
}

export function isPcloudTokenFieldPresentButInvalidInConfig(
    config: RemoteConfigSnapshot,
): boolean {
    const tokenJson = trim(config["backup.remote.pcloud.tokenJson"] as string);
    return Boolean(tokenJson && !isValidPcloudTokenJson(tokenJson));
}

export function isRemoteCredentialsCompleteInConfig(
    config: RemoteConfigSnapshot,
): boolean {
    return resolveRemoteTransport(getRemoteStorageCredentialsFromConfig(config))
        !== null;
}

export function getWebdavRootPath(config: RemoteConfigSnapshot): string {
    return normalizeWebdavRootPath(
        config["backup.webdav.rootPath"] as string | undefined,
    );
}

export function getRemoteStorageCredentialsFromConfig(
    config: RemoteConfigSnapshot,
): RemoteStorageCredentials {
    return {
        webdav: {
            url: normalizeWebdavServerUrl(
                readString(config, "backup.webdav.url", "webdav.url"),
            ),
            rootPath: getWebdavRootPath(config),
            username: readString(
                config,
                "backup.webdav.username",
                "webdav.username",
            ),
            password: readString(
                config,
                "backup.webdav.password",
                "webdav.password",
            ),
        },
        pcloud: {
            hostname:
                trim(
                    config["backup.remote.pcloud.hostname"] as string | undefined,
                ) || DEFAULT_PCLOUD_HOSTNAME,
            tokenJson: trim(
                config["backup.remote.pcloud.tokenJson"] as string | undefined,
            ),
        },
    };
}

export function getRemoteMusicPath(config: RemoteConfigSnapshot): string {
    return trim(config["backup.remote.musicPath"] as string | undefined);
}

export function isRemoteMusicAvailableInConfig(
    config: RemoteConfigSnapshot,
): boolean {
    if (!isRemoteCredentialsCompleteInConfig(config)) {
        return false;
    }
    return Boolean(resolveFirstSearchPathSegment(getRemoteMusicPath(config)));
}

/** Prefer unified remote sync keys; fall back to legacy Android `webdav.*`. */
export function getRemoteAutoSync(config: RemoteConfigSnapshot): boolean {
    const remote = config["backup.remote.autoSync"];
    if (remote !== undefined && remote !== null) {
        return remote === true;
    }
    return config["webdav.autoSync"] === true;
}

export function getRemotePendingPush(config: RemoteConfigSnapshot): boolean {
    const remote = config["backup.remote.pendingPush"];
    if (remote !== undefined && remote !== null) {
        return remote === true;
    }
    return config["webdav.pendingPush"] === true;
}

export function getRemoteLastSuccessfulPushAt(
    config: RemoteConfigSnapshot,
): number | null | undefined {
    const remote = config["backup.remote.lastSuccessfulPushAt"];
    if (remote !== undefined && remote !== null) {
        return remote;
    }
    return config["webdav.lastSuccessfulPushAt"];
}

export function getRemoteBackupSourceDeviceId(
    config: RemoteConfigSnapshot,
): string | undefined {
    const remote = trim(
        config["backup.remote.backupSourceDeviceId"] as string | undefined,
    );
    if (remote) {
        return remote;
    }
    return trim(
        config["webdav.backupSourceDeviceId"] as string | undefined,
    ) || undefined;
}

/**
 * Mirror legacy sync writes into unified remote keys and normalize WebDAV URL/root.
 */
export function normalizeRemoteConfigPatch(
    patch: RemoteConfigSnapshot,
): RemoteConfigSnapshot {
    const result: RemoteConfigSnapshot = { ...patch };

    if (
        "webdav.autoSync" in result
        && !("backup.remote.autoSync" in result)
    ) {
        result["backup.remote.autoSync"] = result["webdav.autoSync"];
    }
    if (
        "webdav.pendingPush" in result
        && !("backup.remote.pendingPush" in result)
    ) {
        result["backup.remote.pendingPush"] = result["webdav.pendingPush"];
    }
    if (
        "webdav.lastSuccessfulPushAt" in result
        && !("backup.remote.lastSuccessfulPushAt" in result)
    ) {
        result["backup.remote.lastSuccessfulPushAt"] =
            result["webdav.lastSuccessfulPushAt"];
    }
    if (
        "webdav.backupSourceDeviceId" in result
        && !("backup.remote.backupSourceDeviceId" in result)
    ) {
        result["backup.remote.backupSourceDeviceId"] =
            result["webdav.backupSourceDeviceId"];
    }

    if (result["backup.remote.autoSync"] === false) {
        result["backup.remote.pendingPush"] = false;
    }
    if (result["webdav.autoSync"] === false) {
        result["webdav.pendingPush"] = false;
    }

    if ("backup.webdav.rootPath" in result) {
        result["backup.webdav.rootPath"] = normalizeWebdavRootPath(
            result["backup.webdav.rootPath"] as string,
        );
    }

    const urlKey = "backup.webdav.url" in result
        ? "backup.webdav.url"
        : "webdav.url" in result
            ? "webdav.url"
            : null;
    if (urlKey) {
        const split = splitWebdavUrlIntoServerAndRoot(
            (result[urlKey] as string) ?? "",
        );
        if (urlKey === "webdav.url") {
            result["webdav.url"] = split.serverUrl;
        } else {
            result["backup.webdav.url"] = split.serverUrl;
        }
        if (
            split.rootPath
            && !normalizeWebdavRootPath(
                result["backup.webdav.rootPath"] as string | undefined,
            )
        ) {
            result["backup.webdav.rootPath"] = split.rootPath;
        }
    }

    return result;
}
