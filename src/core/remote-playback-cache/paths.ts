import pathConst from "@/constants/pathConst";
import { checkAndCreateDir } from "@/utils/fileUtils";
import CryptoJs from "crypto-js";

/** Offline cache directory for previously played remote tracks. */
export const remotePlaybackCacheDir = `${pathConst.cachePath}remote-playback/`;

function extensionOf(remotePath: string): string {
    const basename = remotePath.split("/").pop() ?? "";
    const lastDot = basename.lastIndexOf(".");
    if (lastDot <= 0) {
        return "";
    }
    return basename.slice(lastDot).toLowerCase();
}

/** Deterministic filesystem-safe key derived from the remote path. */
export function cacheKeyForRemotePath(remotePath: string): string {
    return CryptoJs.MD5(remotePath).toString(CryptoJs.enc.Hex);
}

/** Absolute local cache path for the audio file (keeps original extension). */
export function localPathForRemote(remotePath: string): string {
    return `${remotePlaybackCacheDir}${cacheKeyForRemotePath(remotePath)}${extensionOf(remotePath)}`;
}

/** Absolute local cache path for the `.lrc` sidecar. */
export function localLrcPathForRemote(remotePath: string): string {
    return `${remotePlaybackCacheDir}${cacheKeyForRemotePath(remotePath)}.lrc`;
}

/** Absolute local cache path for the `.tran.lrc` sidecar. */
export function localTranLrcPathForRemote(remotePath: string): string {
    return `${remotePlaybackCacheDir}${cacheKeyForRemotePath(remotePath)}.tran.lrc`;
}

export async function ensureRemotePlaybackCacheDir(): Promise<void> {
    await checkAndCreateDir(remotePlaybackCacheDir);
}
