import lyricManager from "@/core/lyricManager";
import LocalMusicSheet from "@/core/localMusicSheet";
import pluginManager from "@/core/pluginManager";
import { WEBDAV_MUSIC_PLUGIN_PLATFORM } from "@/core/webdav-download/config";
import {
    uploadRemoteSidecarLyrics,
} from "@/core/webdav-download/sidecar";
import { RemoteMusicConfigIncompleteError } from "@/core/webdav-download/upload";
import { localSidecarPathsForAudio } from "@/utils/renameDownloadPath";
import { getLocalPath } from "@/utils/mediaUtils";
import { getMediaExtraProperty } from "@/utils/mediaExtra";
import { writeFile } from "react-native-fs";

export class SaveSearchedLyricError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = "SaveSearchedLyricError";
    }
}

export const SaveSearchedLyricErrorCode = {
    WEBDAV_CONFIG_INCOMPLETE: "WEBDAV_CONFIG_INCOMPLETE",
    LYRIC_EMPTY: "LYRIC_EMPTY",
    UPLOAD_FAILED: "UPLOAD_FAILED",
    DOWNLOAD_PATH_MISSING: "DOWNLOAD_PATH_MISSING",
    WEBDAV_REMOTE_PATH_MISSING: "WEBDAV_REMOTE_PATH_MISSING",
} as const;

async function fetchLyricFromSearchResult(
    lyricItem: IMusic.IMusicItem,
): Promise<{ rawLrc: string; translation?: string }> {
    const lrcSource = await pluginManager
        .getByMedia(lyricItem)
        ?.methods?.getLyric(lyricItem);
    let rawLrc = lrcSource?.rawLrc?.trim();
    let translation = lrcSource?.translation?.trim();
    if (!rawLrc && !translation) {
        throw new SaveSearchedLyricError(SaveSearchedLyricErrorCode.LYRIC_EMPTY);
    }
    if (!rawLrc) {
        rawLrc = translation;
        translation = undefined;
    }
    return { rawLrc: rawLrc!, translation };
}

async function writeLocalSidecarLyrics(
    audioPath: string,
    rawLrc: string,
    translation?: string,
): Promise<void> {
    const paths = localSidecarPathsForAudio(audioPath);
    await writeFile(paths.lrcPath, rawLrc, "utf8");
    if (translation) {
        await writeFile(paths.tranLrcPath, translation, "utf8");
    }
}

async function saveToWebdavSidecar(
    musicItem: IMusic.IMusicItem,
    rawLrc: string,
    translation?: string,
): Promise<void> {
    const remoteAudioPath = musicItem.id?.trim();
    if (!remoteAudioPath) {
        throw new SaveSearchedLyricError(
            SaveSearchedLyricErrorCode.WEBDAV_REMOTE_PATH_MISSING,
        );
    }
    try {
        await uploadRemoteSidecarLyrics({
            remoteAudioPath,
            rawLrc,
            translation,
        });
    } catch (e: unknown) {
        if (e instanceof RemoteMusicConfigIncompleteError) {
            throw new SaveSearchedLyricError(
                SaveSearchedLyricErrorCode.WEBDAV_CONFIG_INCOMPLETE,
            );
        }
        if (e instanceof Error && e.message === "LYRIC_EMPTY") {
            throw new SaveSearchedLyricError(SaveSearchedLyricErrorCode.LYRIC_EMPTY);
        }
        throw new SaveSearchedLyricError(SaveSearchedLyricErrorCode.UPLOAD_FAILED);
    }
}

async function saveToLocalDownloadSidecar(
    musicItem: IMusic.IMusicItem,
    rawLrc: string,
    translation?: string,
): Promise<void> {
    const audioPath = getLocalPath(musicItem)?.trim();
    if (!audioPath) {
        throw new SaveSearchedLyricError(
            SaveSearchedLyricErrorCode.DOWNLOAD_PATH_MISSING,
        );
    }
    try {
        await writeLocalSidecarLyrics(audioPath, rawLrc, translation);
    } catch {
        throw new SaveSearchedLyricError(SaveSearchedLyricErrorCode.UPLOAD_FAILED);
    }
}

function clearStaleLinkedLyricIfNeeded(musicItem: IMusic.IMusicItem): void {
    const linked = getMediaExtraProperty(musicItem, "associatedLrc");
    if (linked) {
        lyricManager.unassociateLyric(musicItem);
    }
}

export async function saveSearchedLyric(
    musicItem: IMusic.IMusicItem,
    lyricItem: IMusic.IMusicItem,
): Promise<void> {
    const { rawLrc, translation } = await fetchLyricFromSearchResult(lyricItem);

    if (musicItem.platform === WEBDAV_MUSIC_PLUGIN_PLATFORM) {
        await saveToWebdavSidecar(musicItem, rawLrc, translation);
        clearStaleLinkedLyricIfNeeded(musicItem);
        return;
    }

    if (LocalMusicSheet.isLocalMusic(musicItem)) {
        await saveToLocalDownloadSidecar(musicItem, rawLrc, translation);
        lyricManager.associateLyric(musicItem, lyricItem);
        return;
    }

    lyricManager.associateLyric(musicItem, lyricItem);
}
