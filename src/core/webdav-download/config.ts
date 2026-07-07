import Config from "@/core/appConfig";
import {
    getRemoteMusicPath,
    getRemoteStorageCredentialsFromConfig,
    isRemoteMusicAvailableInConfig,
    type RemoteConfigSnapshot,
} from "@/core/remote-storage/remote-config";
import { resolveRemoteTransport } from "@/core/remote-storage/resolve";

import { resolveFirstSearchPathSegment } from "./path";

export { resolveFirstSearchPathSegment } from "./path";

/** Music library remote plugin platform (built-in WebDAV source). */
export const WEBDAV_MUSIC_PLUGIN_PLATFORM = "WebDAV" as const;

export type DownloadDestination = "local" | "webdav";

export function readRemoteMusicConfigSnapshot(): RemoteConfigSnapshot {
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
        "backup.remote.musicPath": Config.getConfig("backup.remote.musicPath"),
        "webdav.url": Config.getConfig("webdav.url"),
        "webdav.username": Config.getConfig("webdav.username"),
        "webdav.password": Config.getConfig("webdav.password"),
    };
}

export function isRemoteMusicAvailable(): boolean {
    return isRemoteMusicAvailableInConfig(readRemoteMusicConfigSnapshot());
}

export function isRemoteDownloadTargetAvailable(): boolean {
    return isRemoteMusicAvailable();
}

export function isWebdavDownloadTargetAvailable(): boolean {
    return isRemoteMusicAvailable();
}

export function getRemoteDownloadTargetSummary(): {
    available: boolean;
    searchPathSegment: string;
    url: string;
} {
    const snapshot = readRemoteMusicConfigSnapshot();
    const musicPath = getRemoteMusicPath(snapshot);
    const creds = getRemoteStorageCredentialsFromConfig(snapshot);
    const transport = resolveRemoteTransport(creds);
    const url =
        transport === "webdav"
            ? (creds.webdav?.url?.trim() ?? "")
            : transport === "pcloud"
                ? (creds.pcloud?.hostname?.trim() ?? "")
                : "";
    return {
        available: isRemoteMusicAvailableInConfig(snapshot),
        searchPathSegment: resolveFirstSearchPathSegment(musicPath),
        url,
    };
}

export function getWebdavDownloadTargetSummary(): {
    available: boolean;
    searchPathSegment: string;
    url: string;
} {
    return getRemoteDownloadTargetSummary();
}
