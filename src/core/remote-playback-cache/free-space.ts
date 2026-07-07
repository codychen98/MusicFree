import { getFSInfo } from "react-native-fs";

import { errorLog } from "@/utils/log";

/**
 * Skip new background caching when the device drops below this free-space
 * threshold. Offline cache retention is unlimited, so this guard protects the
 * device from being filled by background downloads.
 */
export const MIN_FREE_SPACE_BYTES = 500 * 1024 * 1024;

/**
 * Whether the device has enough free storage to accept a new cache download.
 *
 * If free space cannot be determined (e.g. `getFSInfo` throws) this returns
 * `true` so the guard never permanently blocks caching; a genuinely full disk
 * will still fail the download itself.
 */
export async function hasSufficientFreeSpace(
    threshold: number = MIN_FREE_SPACE_BYTES,
): Promise<boolean> {
    try {
        const info = await getFSInfo();
        return (info?.freeSpace ?? 0) >= threshold;
    } catch (e: unknown) {
        errorLog("Remote-缓存可用空间检测失败", {
            reason: e instanceof Error ? e.message : e,
        });
        return true;
    }
}
