import { internalSerializeKey, localPluginPlatform } from "@/constants/commonConst";
import LocalMusicSheet from "@/core/localMusicSheet";
import musicHistory from "@/core/musicHistory";
import MusicSheet from "@/core/musicSheet";
import trackPlayer from "@/core/trackPlayer";
import { WEBDAV_MUSIC_PLUGIN_PLATFORM } from "@/core/webdav-download/config";
import { markWebdavLocalMutation } from "@/core/webdav-sync/bridge";
import {
    isSameMediaItem,
} from "@/utils/mediaUtils";
import {
    patchMediaExtra,
    removeMediaExtra,
} from "@/utils/mediaExtra";

export interface MigrateTrackToWebdavParams {
    remotePath: string;
    title: string;
    artist: string;
    album?: string;
    duration?: number;
}

export interface MigrateTrackToWebdavResult {
    newItem: IMusic.IMusicItem;
    sheetsReplaced: number;
    historyReplaced: number;
    playListReplaced: number;
    localRemoved: boolean;
}

function buildMigratedMusicItem(
    seed: IMusic.IMusicItem,
    params: MigrateTrackToWebdavParams,
): IMusic.IMusicItem {
    const serialized = seed[internalSerializeKey];
    const next: IMusic.IMusicItem = {
        ...seed,
        platform: WEBDAV_MUSIC_PLUGIN_PLATFORM,
        id: params.remotePath,
        title: params.title,
        artist: params.artist,
        album: params.album ?? seed.album ?? "未知专辑",
        duration: params.duration ?? seed.duration ?? 0,
        [internalSerializeKey]: undefined,
    };
    if (serialized && typeof serialized === "object") {
        const { localPath: _localPath, ...restSerialize } = serialized as Record<
            string,
            unknown
        >;
        if (Object.keys(restSerialize).length) {
            next[internalSerializeKey] = restSerialize;
        }
    }
    return next;
}

function applyWebdavMediaExtra(newItem: IMusic.IMusicItem): void {
    patchMediaExtra(newItem, {
        downloaded: true,
        localPath: undefined,
    });
}

async function migrateHistory(
    oldItem: IMusic.IMusicItem,
    params: MigrateTrackToWebdavParams,
): Promise<number> {
    let count = 0;
    const nextHistory = musicHistory.history.map(row => {
        if (!isSameMediaItem(oldItem, row)) {
            return row;
        }
        count += 1;
        return buildMigratedMusicItem(row, params);
    });
    if (count > 0) {
        await musicHistory.setHistory(nextHistory);
        markWebdavLocalMutation();
    }
    return count;
}

async function removeLocalDuplicates(
    oldItem: IMusic.IMusicItem,
    newItem: IMusic.IMusicItem,
): Promise<boolean> {
    let removed = false;
    if (LocalMusicSheet.isLocalMusic(oldItem)) {
        await LocalMusicSheet.removeMusic(oldItem);
        removed = true;
    }
    const locals = LocalMusicSheet.getMusicList();
    for (const row of locals) {
        if (row.platform !== localPluginPlatform) {
            continue;
        }
        if (
            row.title === newItem.title &&
            row.artist === newItem.artist &&
            !isSameMediaItem(oldItem, row)
        ) {
            await LocalMusicSheet.removeMusic(row);
            removed = true;
        }
    }
    return removed;
}

/**
 * Point one logical track at `WebDAV@remotePath` across playlists, history, and queue.
 */
export async function migrateTrackToWebdavSource(
    oldItem: IMusic.IMusicItem,
    params: MigrateTrackToWebdavParams,
): Promise<MigrateTrackToWebdavResult> {
    const newItem = buildMigratedMusicItem(oldItem, params);
    const sheetsReplaced = await MusicSheet.replaceMatchingMusicEverywhere(
        oldItem,
        newItem,
    );

    removeMediaExtra(oldItem);
    applyWebdavMediaExtra(newItem);

    const historyReplaced = await migrateHistory(oldItem, params);

    const playListBefore = trackPlayer.playList.filter(it =>
        isSameMediaItem(oldItem, it),
    ).length;
    trackPlayer.replaceMatchingMusic(oldItem, newItem);
    const playListReplaced = playListBefore;

    const localRemoved = await removeLocalDuplicates(oldItem, newItem);

    return {
        newItem,
        sheetsReplaced,
        historyReplaced,
        playListReplaced,
        localRemoved,
    };
}
