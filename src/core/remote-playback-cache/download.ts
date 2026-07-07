import { downloadFile, exists, stat, unlink, writeFile } from "react-native-fs";

import { getRemoteDownloadUrl } from "@/core/remote-storage/playback-client";
import { fetchRemoteSidecarLyrics } from "@/core/webdav-download/sidecar";
import { addFileScheme } from "@/utils/fileUtils";
import { errorLog } from "@/utils/log";

import {
    getCacheEntry,
    setCacheEntry,
    type RemotePlaybackCacheEntry,
} from "./index-store";
import {
    ensureRemotePlaybackCacheDir,
    localLrcPathForRemote,
    localPathForRemote,
    localTranLrcPathForRemote,
} from "./paths";
import { hasSufficientFreeSpace } from "./free-space";

export type CacheRemoteTrackReason =
    | "already-cached"
    | "low-space"
    | "no-url"
    | "invalid-path"
    | "error";

export interface CacheRemoteTrackResult {
    cached: boolean;
    reason?: CacheRemoteTrackReason;
}

async function isEntryValid(remotePath: string): Promise<boolean> {
    const entry = getCacheEntry(remotePath);
    if (!entry?.localPath) {
        return false;
    }
    try {
        return await exists(entry.localPath);
    } catch {
        return false;
    }
}

async function resolveFileSize(
    localPath: string,
    bytesWritten?: number,
): Promise<number> {
    if (typeof bytesWritten === "number" && bytesWritten > 0) {
        return bytesWritten;
    }
    try {
        const info = await stat(localPath);
        const size = Number(info.size);
        return Number.isFinite(size) ? size : 0;
    } catch {
        return bytesWritten ?? 0;
    }
}

async function cacheSidecars(
    remotePath: string,
): Promise<{ lrcPath?: string; tranLrcPath?: string }> {
    try {
        const lyrics = await fetchRemoteSidecarLyrics(remotePath);
        const result: { lrcPath?: string; tranLrcPath?: string } = {};
        if (lyrics.rawLrc) {
            const lrcPath = localLrcPathForRemote(remotePath);
            await writeFile(lrcPath, lyrics.rawLrc, "utf8");
            result.lrcPath = lrcPath;
        }
        if (lyrics.translation) {
            const tranLrcPath = localTranLrcPathForRemote(remotePath);
            await writeFile(tranLrcPath, lyrics.translation, "utf8");
            result.tranLrcPath = tranLrcPath;
        }
        return result;
    } catch (e: unknown) {
        errorLog("Remote-缓存歌词失败", {
            remotePath,
            reason: e instanceof Error ? e.message : e,
        });
        return {};
    }
}

/**
 * Download a remote track (and its `.lrc` / `.tran.lrc` sidecars) into the
 * offline playback cache and write an index entry.
 *
 * Skips work when the track is already cached with an on-disk file, or when the
 * device is below the free-space guard threshold. Never throws; failures are
 * logged and reported via the returned reason.
 */
export async function cacheRemoteTrack(
    remotePath: string,
): Promise<CacheRemoteTrackResult> {
    const normalized = remotePath?.trim();
    if (!normalized) {
        return { cached: false, reason: "invalid-path" };
    }

    if (await isEntryValid(normalized)) {
        return { cached: false, reason: "already-cached" };
    }

    if (!(await hasSufficientFreeSpace())) {
        return { cached: false, reason: "low-space" };
    }

    const localPath = localPathForRemote(normalized);

    try {
        const url = await getRemoteDownloadUrl(normalized);
        if (!url) {
            return { cached: false, reason: "no-url" };
        }

        await ensureRemotePlaybackCacheDir();

        const { promise } = downloadFile({
            fromUrl: url,
            toFile: addFileScheme(localPath),
            background: true,
        });
        const result = await promise;
        if (result.statusCode && result.statusCode >= 400) {
            try {
                await unlink(addFileScheme(localPath));
            } catch {
                // ignore cleanup failure
            }
            return { cached: false, reason: "error" };
        }

        const size = await resolveFileSize(localPath, result.bytesWritten);
        const sidecars = await cacheSidecars(normalized);

        const now = Date.now();
        const entry: RemotePlaybackCacheEntry = {
            remotePath: normalized,
            localPath,
            size,
            cachedAt: now,
            lastPlayedAt: now,
            ...sidecars,
        };
        setCacheEntry(entry);

        return { cached: true };
    } catch (e: unknown) {
        errorLog("Remote-缓存播放文件失败", {
            remotePath: normalized,
            reason: e instanceof Error ? e.message : e,
        });
        return { cached: false, reason: "error" };
    }
}
