import { exists, unlink } from "react-native-fs";

import { errorLog } from "@/utils/log";

import { clearCacheIndex, getCacheEntry, removeCacheEntry } from "./index-store";
import { remotePlaybackCacheDir } from "./paths";

async function safeUnlink(path: string | undefined): Promise<void> {
    if (!path) {
        return;
    }
    try {
        if (await exists(path)) {
            await unlink(path);
        }
    } catch {
        // Best-effort deletion; index is cleared regardless.
    }
}

/**
 * Remove the entire offline playback cache: delete the cache directory contents
 * and clear the index. The index is cleared even if directory removal fails so
 * stale rows never linger.
 */
export async function clearRemotePlaybackCache(): Promise<void> {
    try {
        if (await exists(remotePlaybackCacheDir)) {
            await unlink(remotePlaybackCacheDir);
        }
    } catch (e: unknown) {
        errorLog("Remote-清理播放缓存失败", {
            reason: e instanceof Error ? e.message : e,
        });
    } finally {
        clearCacheIndex();
    }
}

/**
 * Remove a single cached track: its audio file, `.lrc` / `.tran.lrc` sidecars,
 * and index entry.
 */
export async function removeCachedTrack(remotePath: string): Promise<void> {
    const normalized = remotePath?.trim();
    if (!normalized) {
        return;
    }
    const entry = getCacheEntry(normalized);
    if (entry) {
        await safeUnlink(entry.localPath);
        await safeUnlink(entry.lrcPath);
        await safeUnlink(entry.tranLrcPath);
    }
    removeCacheEntry(normalized);
}
