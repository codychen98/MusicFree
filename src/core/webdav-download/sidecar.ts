import { errorLog } from "@/utils/log";
import { AuthType, createClient, type WebDAVClient } from "webdav";

import { remotePathsForWebdavTrack } from "./path";
import {
    getWebdavMusicPluginConfig,
    type WebdavMusicPluginConfig,
} from "./upload";

export interface FetchRemoteSidecarLyricsResult {
    rawLrc?: string;
    translation?: string;
}

export interface UploadRemoteSidecarLyricsInput {
    remoteAudioPath: string;
    rawLrc: string;
    translation?: string;
}

let cachedClient: WebDAVClient | null = null;
let cachedClientKey = "";

function getWebdavMusicClient(config: WebdavMusicPluginConfig): WebDAVClient {
    const key = `${config.url}\0${config.username}\0${config.password}`;
    if (cachedClient && cachedClientKey === key) {
        return cachedClient;
    }
    cachedClient = createClient(config.url, {
        authType: AuthType.Password,
        username: config.username,
        password: config.password,
    });
    cachedClientKey = key;
    return cachedClient;
}

async function readRemoteTextIfExists(
    client: WebDAVClient,
    remotePath: string,
): Promise<string | undefined> {
    if (!(await client.exists(remotePath))) {
        return undefined;
    }
    const contents = await client.getFileContents(remotePath, {
        format: "text",
    });
    if (typeof contents !== "string" || !contents.trim()) {
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

    const config = getWebdavMusicPluginConfig();
    const client = getWebdavMusicClient(config);
    const paths = remotePathsForWebdavTrack(normalizedPath);

    try {
        const rawLrc = await readRemoteTextIfExists(client, paths.lrcPath);
        const translation = await readRemoteTextIfExists(
            client,
            paths.tranLrcPath,
        );
        return {
            ...(rawLrc !== undefined ? { rawLrc } : {}),
            ...(translation !== undefined ? { translation } : {}),
        };
    } catch (e: unknown) {
        errorLog("WebDAV-读取远程歌词失败", {
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

    const config = getWebdavMusicPluginConfig();
    const client = getWebdavMusicClient(config);
    const paths = remotePathsForWebdavTrack(remoteAudioPath);

    try {
        await client.putFileContents(paths.lrcPath, rawLrc, {
            overwrite: true,
        });

        const translation = input.translation?.trim();
        if (translation) {
            await client.putFileContents(paths.tranLrcPath, translation, {
                overwrite: true,
            });
        }
    } catch (e: unknown) {
        errorLog("WebDAV-上传远程歌词失败", {
            remoteAudioPath,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}
