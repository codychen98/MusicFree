import {
    getRemoteTextForPlayback,
    remoteExistsForPlayback,
} from "@/core/remote-storage/playback-client";
import { errorLog } from "@/utils/log";

import { remotePathsForWebdavTrack } from "./path";
import type {
    FetchRemoteSidecarLyricsResult,
    UploadRemoteSidecarLyricsInput,
} from "./types";
import { getRemoteMusicClient } from "./upload";

async function readRemoteTextIfExists(
    remotePath: string,
): Promise<string | undefined> {
    if (!(await remoteExistsForPlayback(remotePath))) {
        return undefined;
    }
    const contents = await getRemoteTextForPlayback(remotePath);
    if (!contents.trim()) {
        return undefined;
    }
    return contents;
}

export async function fetchRemoteSidecarLyrics(
    remoteAudioPath: string,
): Promise<FetchRemoteSidecarLyricsResult> {
    const normalizedPath = remoteAudioPath?.trim();
    if (!normalizedPath) {
        return {};
    }

    const paths = remotePathsForWebdavTrack(normalizedPath);

    try {
        const rawLrc = await readRemoteTextIfExists(paths.lrcPath);
        const translation = await readRemoteTextIfExists(paths.tranLrcPath);
        return {
            ...(rawLrc !== undefined ? { rawLrc } : {}),
            ...(translation !== undefined ? { translation } : {}),
        };
    } catch (e: unknown) {
        errorLog("Remote-读取远程歌词失败", {
            remoteAudioPath: normalizedPath,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}

export async function uploadRemoteSidecarLyrics(
    input: UploadRemoteSidecarLyricsInput,
): Promise<void> {
    const remoteAudioPath = input.remoteAudioPath?.trim();
    const rawLrc = input.rawLrc?.trim();
    if (!remoteAudioPath) {
        throw new Error("WEBDAV_REMOTE_PATH_MISSING");
    }
    if (!rawLrc) {
        throw new Error("LYRIC_EMPTY");
    }

    const client = getRemoteMusicClient();
    const paths = remotePathsForWebdavTrack(remoteAudioPath);

    try {
        await client.putText(paths.lrcPath, rawLrc);

        const translation = input.translation?.trim();
        if (translation) {
            await client.putText(paths.tranLrcPath, translation);
        }
    } catch (e: unknown) {
        errorLog("Remote-上传远程歌词失败", {
            remoteAudioPath,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}

export type {
    FetchRemoteSidecarLyricsResult,
    UploadRemoteSidecarLyricsInput,
} from "./types";
