import Config from "@/core/appConfig";
import { cacheRemoteTrack } from "@/core/remote-playback-cache/download";
import { getCachedPlaybackFileUrl } from "@/core/remote-playback-cache/lookup";
import { getRemoteDownloadUrl } from "@/core/remote-storage/playback-client";
import {
    getRemoteMusicPath,
    getRemoteStorageCredentialsFromConfig,
    REMOTE_MUSIC_PLUGIN_HASH,
    REMOTE_MUSIC_PLUGIN_PLATFORM,
} from "@/core/remote-storage/remote-config";
import { resolveRemoteTransport } from "@/core/remote-storage/resolve";
import type { RemoteDirectoryEntry, RemoteStorageClient } from "@/core/remote-storage/types";
import { readRemoteMusicConfigSnapshot } from "@/core/webdav-download/config";
import { getRemoteMusicClient } from "@/core/webdav-download/upload";
import { parseDownloadBasename } from "@/utils/downloadFilename";

import { Plugin } from "./plugin";

const AUDIO_EXT = [
    ".mp3",
    ".flac",
    ".wma",
    ".wav",
    ".m4a",
    ".ogg",
    ".acc",
    ".aac",
    ".ape",
    ".opus",
];

function isAudioFile(entry: RemoteDirectoryEntry): boolean {
    if (entry.type !== "file") {
        return false;
    }
    if (entry.mime?.startsWith("audio")) {
        return true;
    }
    const name = entry.basename.toLowerCase();
    return AUDIO_EXT.some((ext) => name.endsWith(ext));
}

function fileEntryToMusicItem(entry: RemoteDirectoryEntry): IMusic.IMusicItem {
    const basename = entry.basename;
    const lastDot = basename.lastIndexOf(".");
    const withoutExt = lastDot === -1 ? basename : basename.slice(0, lastDot);
    const parsed = parseDownloadBasename(withoutExt);
    if (parsed) {
        return {
            platform: REMOTE_MUSIC_PLUGIN_PLATFORM,
            title: parsed.title,
            id: entry.path,
            artist: parsed.artist,
            album: "未知专辑",
        };
    }
    return {
        platform: REMOTE_MUSIC_PLUGIN_PLATFORM,
        title: withoutExt || basename,
        id: entry.path,
        artist: "未知作者",
        album: "未知专辑",
    };
}

function parseMusicPathSegments(musicPath: string): string[] {
    if (!musicPath.trim()) {
        return [];
    }
    return musicPath
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean);
}

let cachedFileList: RemoteDirectoryEntry[] | null = null;
let cachedFileListKey = "";

function buildFileListCacheKey(): string {
    const config = readRemoteMusicConfigSnapshot();
    const musicPath = getRemoteMusicPath(config);
    const creds = getRemoteStorageCredentialsFromConfig(config);
    const transport = resolveRemoteTransport(creds);
    return `${transport ?? ""}\0${musicPath}\0${JSON.stringify(creds)}`;
}

async function loadCachedAudioFiles(): Promise<RemoteDirectoryEntry[]> {
    const key = buildFileListCacheKey();
    if (cachedFileList && cachedFileListKey === key) {
        return cachedFileList;
    }

    const musicPath = getRemoteMusicPath(readRemoteMusicConfigSnapshot());
    const segments = parseMusicPathSegments(musicPath);
    if (!segments.length) {
        cachedFileList = [];
        cachedFileListKey = key;
        return [];
    }

    let client: RemoteStorageClient;
    try {
        client = getRemoteMusicClient();
    } catch {
        cachedFileList = [];
        cachedFileListKey = key;
        return [];
    }

    const result: RemoteDirectoryEntry[] = [];
    for (const searchPath of segments) {
        try {
            const items = await client.listDirectory(searchPath);
            result.push(...items.filter(isAudioFile));
        } catch {
            // Ignore per-root listing failures (parity with external WebDAV plugin).
        }
    }

    cachedFileList = result;
    cachedFileListKey = key;
    return result;
}

function remoteMusicPluginDefine(): IPlugin.IPluginDefine {
    return {
        platform: REMOTE_MUSIC_PLUGIN_PLATFORM,
        supportedSearchType: ["music"],
        async search(query, _page, type) {
            if (type !== "music") {
                return { isEnd: true, data: [] as IMedia.SupportMediaItem[typeof type][] };
            }
            const files = await loadCachedAudioFiles();
            return {
                isEnd: true,
                data: files
                    .filter((entry) => entry.basename.includes(query))
                    .map(fileEntryToMusicItem) as IMedia.SupportMediaItem[typeof type][],
            };
        },
        async getTopLists() {
            const musicPath = getRemoteMusicPath(readRemoteMusicConfigSnapshot());
            const segments = parseMusicPathSegments(musicPath);
            if (!segments.length) {
                return [];
            }
            try {
                getRemoteMusicClient();
            } catch {
                return [];
            }
            return [
                {
                    title: "全部歌曲",
                    data: segments.map((segment) => ({
                        platform: REMOTE_MUSIC_PLUGIN_PLATFORM,
                        title: segment,
                        id: segment,
                    })),
                },
            ];
        },
        async getTopListDetail(topListItem) {
            let client: RemoteStorageClient;
            try {
                client = getRemoteMusicClient();
            } catch {
                return { musicList: [] };
            }
            try {
                const fileItems = (
                    await client.listDirectory(topListItem.id)
                ).filter(isAudioFile);
                return {
                    musicList: fileItems.map(fileEntryToMusicItem),
                };
            } catch {
                return { musicList: [] };
            }
        },
        async getMediaSource(musicItem) {
            const remotePath = musicItem.id;

            if (Config.getConfig("basic.remotePlaybackCacheEnabled") !== false) {
                const cachedUrl = await getCachedPlaybackFileUrl(remotePath);
                if (cachedUrl) {
                    return { url: cachedUrl };
                }
            }

            const url = await getRemoteDownloadUrl(remotePath);

            if (
                url &&
                Config.getConfig("basic.autoCachePlayedRemoteMusic") !== false
            ) {
                // Fire-and-forget background cache of the full file + sidecars.
                // cacheRemoteTrack never throws; it reports failures via reason.
                void cacheRemoteTrack(remotePath);
            }

            return { url };
        },
    };
}

const remoteMusicPlugin = new Plugin(
    remoteMusicPluginDefine,
    "internal-plugin://remote-music-plugin",
);
remoteMusicPlugin.hash = REMOTE_MUSIC_PLUGIN_HASH;

export default remoteMusicPlugin;
