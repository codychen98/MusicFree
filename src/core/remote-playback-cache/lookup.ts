import { exists, readFile } from "react-native-fs";

import {
    getCacheEntry,
    removeCacheEntry,
    touchCacheEntry,
} from "./index-store";

function toFileUrl(localPath: string): string {
    return localPath.startsWith("/") ? `file://${localPath}` : localPath;
}

export interface CachedLyrics {
    rawLrc?: string;
    translation?: string;
}

async function readSidecarIfExists(
    localPath: string | undefined,
): Promise<string | undefined> {
    if (!localPath) {
        return undefined;
    }
    if (!(await exists(localPath))) {
        return undefined;
    }
    const contents = await readFile(localPath, "utf8");
    return contents.trim() ? contents : undefined;
}

/**
 * Read cached `.lrc` / `.tran.lrc` sidecars for a remote track from the offline
 * playback cache. Returns `null` when no cached lyrics are available so callers
 * can fall back to fetching from remote storage.
 */
export async function getCachedLyrics(
    remotePath: string,
): Promise<CachedLyrics | null> {
    const normalized = remotePath?.trim();
    if (!normalized) {
        return null;
    }
    const entry = getCacheEntry(normalized);
    if (!entry) {
        return null;
    }
    const rawLrc = await readSidecarIfExists(entry.lrcPath);
    const translation = await readSidecarIfExists(entry.tranLrcPath);
    if (!rawLrc && !translation) {
        return null;
    }
    return {
        ...(rawLrc !== undefined ? { rawLrc } : {}),
        ...(translation !== undefined ? { translation } : {}),
    };
}

/**
 * Return a `file://` URL for a cached remote track when the index entry and the
 * on-disk file both exist. Self-heals stale index rows (file deleted underneath)
 * and bumps `lastPlayedAt` on a hit.
 */
export async function getCachedPlaybackFileUrl(
    remotePath: string,
): Promise<string | null> {
    const normalized = remotePath?.trim();
    if (!normalized) {
        return null;
    }
    const entry = getCacheEntry(normalized);
    if (!entry?.localPath) {
        return null;
    }
    if (!(await exists(entry.localPath))) {
        removeCacheEntry(normalized);
        return null;
    }
    touchCacheEntry(normalized);
    return toFileUrl(entry.localPath);
}
