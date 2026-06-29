import { internalSerializeKey } from "@/constants/commonConst";
import LocalMusicSheet from "@/core/localMusicSheet";
import { migrateTrackToWebdavSource } from "@/core/migrateTrackToWebdavSource";
import MusicSheet from "@/core/musicSheet";
import trackPlayer from "@/core/trackPlayer";
import { WEBDAV_MUSIC_PLUGIN_PLATFORM } from "@/core/webdav-download/config";
import { remotePathFor } from "@/core/webdav-download/path";
import { renameWebdavRemoteTrack } from "@/core/webdav-download/rename";
import { markWebdavLocalMutation } from "@/core/webdav-sync/bridge";
import {
    buildNewLocalAudioPath,
    buildRenamedAudioFilename,
    getAudioBasename,
    localSidecarPathsForAudio,
} from "@/utils/renameDownloadPath";
import { getLocalPath, isSameMediaItem } from "@/utils/mediaUtils";
import { patchMediaExtra } from "@/utils/mediaExtra";
import { exists, moveFile } from "react-native-fs";

export class RenameTrackError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = "RenameTrackError";
    }
}

export interface RenameMusicTrackInput {
    title: string;
    artist: string;
}

function computeNewRemoteAudioPath(
    oldRemoteAudioPath: string,
    title: string,
    artist: string,
): string {
    const normalized = oldRemoteAudioPath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    const remoteDir =
        lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
    const currentFilename =
        lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
    const newFilename = buildRenamedAudioFilename(
        currentFilename,
        title,
        artist,
    );
    return remotePathFor(remoteDir, newFilename);
}

async function finalizeTrackRename(
    oldItem: IMusic.IMusicItem,
    newItem: IMusic.IMusicItem,
): Promise<void> {
    await trackPlayer.refreshAfterTrackRename(oldItem, newItem);
}

async function updateLocalSheetEntry(
    oldItem: IMusic.IMusicItem,
    newItem: IMusic.IMusicItem,
): Promise<void> {
    if (!LocalMusicSheet.isLocalMusic(oldItem)) {
        return;
    }
    const list = LocalMusicSheet.getMusicList();
    const newList = list.map(row =>
        isSameMediaItem(row, oldItem) ? newItem : row,
    );
    await LocalMusicSheet.updateMusicList(newList);
}

async function updateMusicMetadataInStore(
    musicItem: IMusic.IMusicItem,
    updates: {
        title: string;
        artist: string;
        localPath?: string;
    },
): Promise<IMusic.IMusicItem> {
    const newItem: IMusic.IMusicItem = {
        ...musicItem,
        title: updates.title,
        artist: updates.artist,
    };

    if (updates.localPath !== undefined) {
        const existingSerialize = musicItem[internalSerializeKey];
        if (existingSerialize && typeof existingSerialize === "object") {
            newItem[internalSerializeKey] = {
                ...(existingSerialize as Record<string, unknown>),
                localPath: updates.localPath,
            };
        } else {
            newItem[internalSerializeKey] = {
                localPath: updates.localPath,
            };
        }
        patchMediaExtra(newItem, {
            downloaded: true,
            localPath: updates.localPath,
        });
    }

    await MusicSheet.replaceMatchingMusicEverywhere(musicItem, newItem);
    await updateLocalSheetEntry(musicItem, newItem);
    trackPlayer.replaceMatchingMusic(musicItem, newItem);
    markWebdavLocalMutation();
    await finalizeTrackRename(musicItem, newItem);
    return newItem;
}

async function assertLocalRenameTargetsFree(
    oldAudioPath: string,
    newAudioPath: string,
): Promise<void> {
    if (await exists(newAudioPath)) {
        throw new RenameTrackError("RENAME_TARGET_EXISTS");
    }

    const oldSidecars = localSidecarPathsForAudio(oldAudioPath);
    const newSidecars = localSidecarPathsForAudio(newAudioPath);

    if (await exists(oldSidecars.lrcPath)) {
        if (await exists(newSidecars.lrcPath)) {
            throw new RenameTrackError("RENAME_TARGET_EXISTS");
        }
    }

    if (await exists(oldSidecars.tranLrcPath)) {
        if (await exists(newSidecars.tranLrcPath)) {
            throw new RenameTrackError("RENAME_TARGET_EXISTS");
        }
    }
}

async function renameLocalFileIfExists(
    oldPath: string,
    newPath: string,
): Promise<void> {
    if (await exists(oldPath)) {
        await moveFile(oldPath, newPath);
    }
}

async function renameLocalDownloadedTrack(
    musicItem: IMusic.IMusicItem,
    title: string,
    artist: string,
): Promise<IMusic.IMusicItem> {
    const currentPath = getLocalPath(musicItem)?.trim();
    if (!currentPath) {
        throw new RenameTrackError("RENAME_DOWNLOAD_PATH_MISSING");
    }

    const currentFilename = getAudioBasename(currentPath);
    const newFilename = buildRenamedAudioFilename(
        currentFilename,
        title,
        artist,
    );

    if (newFilename === currentFilename) {
        return updateMusicMetadataInStore(musicItem, { title, artist });
    }

    const newPath = buildNewLocalAudioPath(currentPath, title, artist);
    await assertLocalRenameTargetsFree(currentPath, newPath);

    const sidecars = localSidecarPathsForAudio(currentPath);
    const newSidecars = localSidecarPathsForAudio(newPath);

    try {
        await renameLocalFileIfExists(currentPath, newPath);
        await renameLocalFileIfExists(sidecars.lrcPath, newSidecars.lrcPath);
        await renameLocalFileIfExists(
            sidecars.tranLrcPath,
            newSidecars.tranLrcPath,
        );
    } catch {
        throw new RenameTrackError("RENAME_FILESYSTEM_FAILED");
    }

    return updateMusicMetadataInStore(musicItem, {
        title,
        artist,
        localPath: newPath,
    });
}

async function renameWebdavTrack(
    musicItem: IMusic.IMusicItem,
    title: string,
    artist: string,
): Promise<IMusic.IMusicItem> {
    const oldRemoteAudioPath = musicItem.id?.trim();
    if (!oldRemoteAudioPath) {
        throw new RenameTrackError("WEBDAV_REMOTE_PATH_MISSING");
    }

    const currentFilename = getAudioBasename(oldRemoteAudioPath);
    const newFilename = buildRenamedAudioFilename(
        currentFilename,
        title,
        artist,
    );

    if (newFilename === currentFilename) {
        return updateMusicMetadataInStore(musicItem, { title, artist });
    }

    const newRemoteAudioPath = computeNewRemoteAudioPath(
        oldRemoteAudioPath,
        title,
        artist,
    );

    try {
        await renameWebdavRemoteTrack({
            oldRemoteAudioPath,
            newRemoteAudioPath,
        });
    } catch (e: unknown) {
        if (e instanceof Error) {
            if (e.message === "WEBDAV_RENAME_TARGET_EXISTS") {
                throw new RenameTrackError("RENAME_TARGET_EXISTS");
            }
            throw e;
        }
        throw new RenameTrackError("RENAME_WEBDAV_FAILED");
    }

    const result = await migrateTrackToWebdavSource(musicItem, {
        remotePath: newRemoteAudioPath,
        title,
        artist,
        album: musicItem.album,
        duration: musicItem.duration,
    });
    markWebdavLocalMutation();
    await finalizeTrackRename(musicItem, result.newItem);
    return result.newItem;
}

export async function renameMusicTrack(
    musicItem: IMusic.IMusicItem,
    input: RenameMusicTrackInput,
): Promise<IMusic.IMusicItem> {
    const title = input.title.trim();
    const artist = input.artist.trim();
    if (!title || !artist) {
        throw new RenameTrackError("RENAME_INVALID_INPUT");
    }

    const isWebdav = musicItem.platform === WEBDAV_MUSIC_PLUGIN_PLATFORM;
    const isLocalDownload = Boolean(LocalMusicSheet.isLocalMusic(musicItem));
    if (!isWebdav && !isLocalDownload) {
        throw new RenameTrackError("RENAME_NOT_SUPPORTED");
    }

    if (isWebdav) {
        return renameWebdavTrack(musicItem, title, artist);
    }

    return renameLocalDownloadedTrack(musicItem, title, artist);
}

export function canRenameMusicTrack(musicItem: IMusic.IMusicItem): boolean {
    return (
        musicItem.platform === WEBDAV_MUSIC_PLUGIN_PLATFORM ||
        Boolean(LocalMusicSheet.isLocalMusic(musicItem))
    );
}
