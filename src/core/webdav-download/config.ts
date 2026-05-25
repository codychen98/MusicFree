import PluginManager from "@/core/pluginManager";
import pluginMeta from "@/core/pluginManager/meta";

import { resolveFirstSearchPathSegment } from "./path";

export { resolveFirstSearchPathSegment } from "./path";

/** Music library WebDAV plugin platform (not Settings backup WebDAV). */
export const WEBDAV_MUSIC_PLUGIN_PLATFORM = "WebDAV" as const;

export type DownloadDestination = "local" | "webdav";

export function getWebdavMusicPluginUserVariables(): Record<string, string> {
    return pluginMeta.getUserVariables(WEBDAV_MUSIC_PLUGIN_PLATFORM) ?? {};
}

export function isWebdavMusicPluginInstalled(): boolean {
    return Boolean(PluginManager.getByName(WEBDAV_MUSIC_PLUGIN_PLATFORM));
}

export function isWebdavDownloadTargetAvailable(): boolean {
    if (!isWebdavMusicPluginInstalled()) {
        return false;
    }
    if (!pluginMeta.isPluginEnabled(WEBDAV_MUSIC_PLUGIN_PLATFORM)) {
        return false;
    }
    const vars = getWebdavMusicPluginUserVariables();
    return Boolean(
        vars.url?.trim() &&
            vars.username?.trim() &&
            vars.password?.trim() &&
            vars.searchPath?.trim(),
    );
}

export function getWebdavDownloadTargetSummary(): {
    available: boolean;
    searchPathSegment: string;
    url: string;
} {
    const vars = getWebdavMusicPluginUserVariables();
    return {
        available: isWebdavDownloadTargetAvailable(),
        searchPathSegment: resolveFirstSearchPathSegment(vars.searchPath),
        url: vars.url?.trim() ?? "",
    };
}
