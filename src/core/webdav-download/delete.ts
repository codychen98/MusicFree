import { errorLog } from "@/utils/log";
import { AuthType, createClient, type WebDAVClient } from "webdav";

import {
    getWebdavMusicPluginConfig,
    type WebdavMusicPluginConfig,
} from "./upload";
import { remotePathsForWebdavTrack } from "./path";

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

async function deleteRemoteFileIfExists(
    client: WebDAVClient,
    remotePath: string,
): Promise<void> {
    if (!(await client.exists(remotePath))) {
        return;
    }
    await client.deleteFile(remotePath);
}

/**
 * Delete a WebDAV-hosted track and its sidecar lyrics from the plugin remote folder.
 * `musicItem.id` must be the full remote audio path.
 */
export async function deleteWebdavRemoteTrack(
    musicItem: IMusic.IMusicItem,
): Promise<void> {
    const remoteAudioPath = musicItem.id?.trim();
    if (!remoteAudioPath) {
        throw new Error("WEBDAV_REMOTE_PATH_MISSING");
    }

    const config = getWebdavMusicPluginConfig();
    const client = getWebdavMusicClient(config);
    const paths = remotePathsForWebdavTrack(remoteAudioPath);

    try {
        await deleteRemoteFileIfExists(client, paths.audioPath);
        await deleteRemoteFileIfExists(client, paths.lrcPath);
        await deleteRemoteFileIfExists(client, paths.tranLrcPath);
    } catch (e: unknown) {
        errorLog("WebDAV-删除远程歌曲失败", {
            remoteAudioPath,
            reason: e instanceof Error ? e.message : e,
        });
        throw e;
    }
}

export { remotePathsForWebdavTrack } from "./path";
