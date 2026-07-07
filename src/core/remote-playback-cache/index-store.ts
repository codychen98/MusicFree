import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";

export interface RemotePlaybackCacheEntry {
    /** Remote storage path (identity key for the track). */
    remotePath: string;
    /** Absolute local file path of the cached audio. */
    localPath: string;
    /** Cached audio file size in bytes. */
    size: number;
    cachedAt: number;
    lastPlayedAt: number;
    /** Absolute local path of cached `.lrc` sidecar, if present. */
    lrcPath?: string;
    /** Absolute local path of cached `.tran.lrc` sidecar, if present. */
    tranLrcPath?: string;
}

const store = getOrCreateMMKV("cache.RemotePlayback", true);

function normalize(remotePath: string | undefined): string {
    return remotePath?.trim() ?? "";
}

export function getCacheEntry(
    remotePath: string,
): RemotePlaybackCacheEntry | null {
    const key = normalize(remotePath);
    if (!key) {
        return null;
    }
    const raw = store.getString(key);
    return raw ? safeParse<RemotePlaybackCacheEntry>(raw) : null;
}

export function setCacheEntry(entry: RemotePlaybackCacheEntry): void {
    const key = normalize(entry.remotePath);
    if (!key) {
        return;
    }
    store.set(key, JSON.stringify({ ...entry, remotePath: key }));
}

export function removeCacheEntry(remotePath: string): void {
    const key = normalize(remotePath);
    if (!key) {
        return;
    }
    store.delete(key);
}

/** Bump `lastPlayedAt` for an existing entry (no-op when absent). */
export function touchCacheEntry(remotePath: string): void {
    const entry = getCacheEntry(remotePath);
    if (!entry) {
        return;
    }
    setCacheEntry({ ...entry, lastPlayedAt: Date.now() });
}

export function listCacheEntries(): RemotePlaybackCacheEntry[] {
    const entries: RemotePlaybackCacheEntry[] = [];
    for (const key of store.getAllKeys()) {
        const raw = store.getString(key);
        const parsed = raw
            ? safeParse<RemotePlaybackCacheEntry>(raw)
            : null;
        if (parsed) {
            entries.push(parsed);
        }
    }
    return entries;
}

export function getTotalCachedSize(): number {
    return listCacheEntries().reduce(
        (total, entry) => total + (entry.size || 0),
        0,
    );
}

export function clearCacheIndex(): void {
    store.clearAll();
}
